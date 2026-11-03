import { evaluateMilestones, type AgentId, type AgentKind, type AxNodeView, type RunEvent } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import type { CreateSandbox, DestroyReason } from '../sandbox/docker.js';
import type { AgentResult } from '../agents/loop.js';
import { runAgent } from '../agents/loop.js';
import { attribute } from '../attribution/attribute.js';
import { runFixLoop } from '../fix/loop.js';
import { speechScript } from '../tts/speech-script.js';
import type { Synthesizer } from '../tts/synthesize.js';
import type { Approvals } from './approval.js';
import type { RunBus } from './events.js';
import type { RunQueue } from './queue.js';
import type { RunRecord, RunStore } from './store.js';

export type RunSpec = RunRecord;
export const FIX_WAIT_MS = 10 * 60_000;

export interface OrchestratorDeps {
  store: RunStore;
  bus: RunBus;
  approvals: Approvals;
  queue: RunQueue;
  createSandbox: CreateSandbox;
  inference: Inference;
  storeUrl: string;
  runAgentFn?: typeof runAgent;
  attributeFn?: typeof attribute;
  runFixLoopFn?: typeof runFixLoop;
  synth: Synthesizer;
  log?: (msg: string) => void;
}

export type FixRequest = 'ok' | 'not-found' | 'not-allowed' | 'not-ready' | 'busy';

export class Orchestrator {
  private readonly runAgentFn: typeof runAgent;
  private readonly attributeFn: typeof attribute;
  private readonly runFixLoopFn: typeof runFixLoop;

  constructor(private readonly d: OrchestratorDeps) {
    this.runAgentFn = d.runAgentFn ?? runAgent;
    this.attributeFn = d.attributeFn ?? attribute;
    this.runFixLoopFn = d.runFixLoopFn ?? runFixLoop;
  }

  private emit = (e: RunEvent) => this.d.bus.publish(e);

  start(run: RunSpec): void {
    this.d.queue.enqueue(run.id, () => this.executeRun(run));
  }

  private finish(run: RunRecord, verified: boolean, error?: string): void {
    if (run.phase === 'finished') return;
    if (run.fixDeadline) clearTimeout(run.fixDeadline);
    this.emit(error ? { t: 'run.finished', runId: run.id, verified, error } : { t: 'run.finished', runId: run.id, verified });
    run.phase = 'finished';
    this.d.approvals.forget(run.id);
  }

  private gateFor(run: RunRecord, agent: AgentId) {
    return (identity: Parameters<Approvals['request']>[2]) => this.d.approvals.request(run.id, agent, identity);
  }

  /** One agent in its own fresh sandbox; the sandbox is destroyed however the agent ends. */
  private async runOne(run: RunRecord, agent: AgentId, kind: AgentKind): Promise<AgentResult> {
    const sb = await this.d.createSandbox({ runId: run.id, agent, mode: run.mode, allowHosts: run.allowHosts });
    run.live.set(agent, sb);
    let reason: DestroyReason = 'error';
    try {
      await sb.rpc.call({ m: 'open', url: run.startUrl, patches: [] }, 60_000);
      const result = await this.runAgentFn({
        runId: run.id, agent, kind, mode: run.mode, goal: run.goal, sandbox: sb, inference: this.d.inference,
        emit: this.emit, storeShot: (png) => this.d.store.addShot(run.id, png), seenInjectionTexts: run.seenInjectionTexts,
        gate: this.gateFor(run, agent), milestonesOf: evaluateMilestones,
      });
      reason = result.outcome === 'timeout' ? 'timeout' : result.outcome === 'error' ? 'error' : 'finished';
      return result;
    } finally {
      run.live.delete(agent);
      await sb.destroy(reason);
    }
  }

  async executeRun(run: RunRecord): Promise<void> {
    run.phase = 'running';
    try {
      const [s, b] = await Promise.allSettled([this.runOne(run, 'sighted', 'sighted'), this.runOne(run, 'blind', 'blind')]);
      if (s.status === 'rejected') throw s.reason;
      if (b.status === 'rejected') throw b.reason;
      run.sighted = s.value;
      const blindOk = b.value.outcome === 'gate' || (run.mode === 'any-url' && b.value.outcome === 'done');
      const finding = await this.attributeFn({
        runId: run.id, mode: run.mode, sighted: s.value, blind: b.value, startUrl: run.startUrl,
        allowHosts: run.allowHosts, patches: [], createSandbox: this.d.createSandbox, emit: this.emit,
      });
      if (!finding || !finding.confirmed || run.mode === 'any-url') {
        this.finish(run, blindOk && !finding?.confirmed);
        return;
      }
      run.firstFinding = finding;
      run.phase = 'awaiting-fix';
      run.fixDeadline = setTimeout(() => {
        if (run.phase === 'awaiting-fix') this.finish(run, false);
      }, FIX_WAIT_MS);
      run.fixDeadline.unref?.();
    } catch (e) {
      this.d.log?.(`run ${run.id} failed: ${String((e as Error)?.stack ?? e)}`);
      this.finish(run, false, String((e as Error)?.message ?? e).slice(0, 300));
    }
  }

  requestFix(runId: string, token: string): FixRequest {
    const run = this.d.store.get(runId);
    if (!run) return 'not-found';
    if (!this.d.approvals.checkToken(runId, token)) return 'not-allowed';
    if (run.phase !== 'awaiting-fix' || !run.firstFinding || !run.sighted) return 'not-ready';
    run.phase = 'fixing';
    if (run.fixDeadline) clearTimeout(run.fixDeadline);
    try {
      this.d.queue.enqueue(run.id, () => this.executeFix(run));
    } catch {
      run.phase = 'awaiting-fix';
      return 'busy';
    }
    return 'ok';
  }

  private async executeFix(run: RunRecord): Promise<void> {
    try {
      const r = await this.runFixLoopFn({
        runId: run.id, goal: run.goal, mode: run.mode, startUrl: run.startUrl, allowHosts: run.allowHosts,
        sighted: run.sighted!, firstFinding: run.firstFinding!, inference: this.d.inference, createSandbox: this.d.createSandbox,
        runAgentFn: this.runAgentFn, attributeFn: this.attributeFn, emit: this.emit,
        gate: (agent, identity) => this.d.approvals.request(run.id, agent, identity),
        storeShot: (png) => this.d.store.addShot(run.id, png), seenInjectionTexts: run.seenInjectionTexts,
      });
      for (const f of r.findings) this.emit({ t: 'finding', finding: f });
      this.finish(run, r.verified);
    } catch (e) {
      this.d.log?.(`fix ${run.id} failed: ${String((e as Error)?.stack ?? e)}`);
      this.finish(run, false, String((e as Error)?.message ?? e).slice(0, 300));
    }
  }

  /** Screen-reader readout of a finding's region, a live sandbox's page, or the agent's last AX view. */
  async listen(runId: string, opts: { agent?: AgentId; cssPath?: string; findingId?: string }): Promise<{ audioUrl: string; script: string } | null> {
    const run = this.d.store.get(runId);
    if (!run) return null;
    let nodes: AxNodeView[] | undefined;
    if (opts.findingId) nodes = run.findings.find((f) => f.id === opts.findingId)?.evidence.blindExcerpt;
    const agent = opts.agent ?? 'blind';
    if (!nodes?.length) {
      const live = run.live.get(agent);
      if (live) nodes = await live.rpc.call<AxNodeView[]>({ m: 'axSpeech', cssPath: opts.cssPath }).catch(() => undefined);
    }
    if (!nodes?.length) nodes = run.lastAx.get(agent) ?? run.lastAx.get('blind');
    const script = speechScript(nodes ?? []);
    if (!script) return null;
    const { id } = await this.d.synth(script);
    return { audioUrl: `/api/audio/${id}.mp3`, script };
  }
}
