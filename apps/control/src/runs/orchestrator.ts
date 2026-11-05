import { evaluateMilestones, modePolicy, type AgentId, type AgentKind, type AxNodeView, type RunEvent } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import type { CreateSandbox } from '../sandbox/docker.js';
import { destroyReasonOf } from '../sandbox/lease.js';
import type { AgentResult } from '../agents/loop.js';
import { runAgent } from '../agents/loop.js';
import { attribute } from '../attribution/attribute.js';
import { runFixLoop } from '../fix/loop.js';
import { speechScript } from '../tts/speech-script.js';
import type { Synthesizer } from '../tts/synthesize.js';
import type { Approvals } from './approval.js';
import type { RunBus } from './events.js';
import { RunLifecycle } from './lifecycle.js';
import { QueueFullError, type RunQueue } from './queue.js';
import type { RunRecord, RunStore } from './store.js';

export { FIX_WAIT_MS, STOP_MESSAGE, STOP_TEARDOWN_MS } from './lifecycle.js';

export type RunSpec = RunRecord;

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
  fixWaitMs?: number;
}

export type FixRequest = 'ok' | 'not-found' | 'not-allowed' | 'not-ready' | 'busy';
export type ControlResult = 'ok' | 'not-found' | 'not-allowed' | 'not-ready';

/** Sequences a run's stages (agents, attribution, wait for Fix & verify, fix loop); the run's lifecycle owns its state. */
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

  /** Queues the run. When the queue is full the run is finished and QueueFullError is rethrown. */
  start(run: RunSpec): void {
    const lc = this.lifecycle(run);
    lc.queued();
    try {
      this.d.queue.enqueue(run.id, () => this.executeRun(run));
    } catch (e) {
      if (e instanceof QueueFullError) lc.finish('error', 'queue full');
      throw e;
    }
  }

  private lifecycle(run: RunRecord): RunLifecycle {
    return (run.lifecycle ??= new RunLifecycle(run, {
      emit: this.emit,
      createSandbox: this.d.createSandbox,
      fixWaitMs: this.d.fixWaitMs,
      onStop: () => {
        this.d.queue.remove(run.id);
        this.d.approvals.denyAll(run.id);
      },
      onFinish: () => this.d.approvals.forget(run.id),
    }));
  }

  private authorize(runId: string, token: string): { run: RunRecord; lc: RunLifecycle } | 'not-found' | 'not-allowed' | 'not-ready' {
    const run = this.d.store.get(runId);
    if (!run) return 'not-found';
    if (!this.d.approvals.checkToken(runId, token)) return 'not-allowed';
    return run.lifecycle ? { run, lc: run.lifecycle } : 'not-ready';
  }

  pauseRun(runId: string, token: string): ControlResult {
    const a = this.authorize(runId, token);
    return typeof a === 'string' ? a : a.lc.pause();
  }

  resumeRun(runId: string, token: string): ControlResult {
    const a = this.authorize(runId, token);
    return typeof a === 'string' ? a : a.lc.resume();
  }

  /** Immediate stop: destroy every live sandbox, deny pending approvals, finish the run. */
  async stopRun(runId: string, token: string): Promise<ControlResult> {
    const a = this.authorize(runId, token);
    return typeof a === 'string' ? a : a.lc.stop();
  }

  requestFix(runId: string, token: string): FixRequest {
    const a = this.authorize(runId, token);
    if (typeof a === 'string') return a;
    const { run, lc } = a;
    if (!run.firstFinding || !run.sighted || !lc.beginFix()) return 'not-ready';
    try {
      this.d.queue.enqueue(runId, () => this.executeFix(run));
    } catch {
      lc.abortFix();
      return 'busy';
    }
    return 'ok';
  }

  /** One agent in its own fresh sandbox; the lease destroys it however the agent ends. */
  private runOne(run: RunRecord, agent: AgentId, kind: AgentKind): Promise<AgentResult> {
    const lc = this.lifecycle(run);
    return lc.lease({ runId: run.id, agent, mode: run.mode, allowHosts: run.allowHosts }, async (sb) => {
      await sb.rpc.call({ m: 'open', url: run.startUrl, patches: [] }, 60_000);
      return this.runAgentFn({
        runId: run.id, agent, kind, mode: run.mode, goal: run.goal, sandbox: sb, inference: this.d.inference,
        emit: this.emit, storeShot: (png) => this.d.store.addShot(run.id, png), seenInjectionTexts: run.seenInjectionTexts,
        gate: (identity) => this.d.approvals.request(run.id, agent, identity), milestonesOf: evaluateMilestones, checkpoint: lc.checkpoint,
      });
    }, (r) => destroyReasonOf(r.outcome));
  }

  async executeRun(run: RunRecord): Promise<void> {
    const lc = this.lifecycle(run);
    if (!lc.begin()) return;
    try {
      const [s, b] = await Promise.allSettled([this.runOne(run, 'sighted', 'sighted'), this.runOne(run, 'blind', 'blind')]);
      if (lc.stopped) return;
      if (s.status === 'rejected') throw s.reason;
      if (b.status === 'rejected') throw b.reason;
      run.sighted = s.value;
      const policy = modePolicy(run.mode);
      const blindOk = policy.succeeded(b.value.outcome);
      const finding = await this.attributeFn({
        runId: run.id, mode: run.mode, sighted: s.value, blind: b.value, startUrl: run.startUrl,
        allowHosts: run.allowHosts, patches: [], lease: lc.lease, emit: this.emit,
      });
      if (lc.stopped) return;
      if (!finding || !finding.confirmed || !policy.fixable) {
        lc.finish(blindOk && !finding?.confirmed ? 'verified' : 'unverified');
        return;
      }
      run.firstFinding = finding;
      lc.awaitFix();
    } catch (e) {
      this.fail(run, 'run', e);
    }
  }

  private async executeFix(run: RunRecord): Promise<void> {
    const lc = this.lifecycle(run);
    if (lc.stopped) return;
    try {
      const r = await this.runFixLoopFn({
        runId: run.id, goal: run.goal, mode: run.mode, startUrl: run.startUrl, allowHosts: run.allowHosts,
        sighted: run.sighted!, firstFinding: run.firstFinding!, inference: this.d.inference, lease: lc.lease,
        runAgentFn: this.runAgentFn, attributeFn: this.attributeFn, emit: this.emit,
        gate: (agent, identity) => this.d.approvals.request(run.id, agent, identity),
        storeShot: (png) => this.d.store.addShot(run.id, png), seenInjectionTexts: run.seenInjectionTexts,
        checkpoint: lc.checkpoint,
      });
      lc.finish(r.verified ? 'verified' : 'unverified');
    } catch (e) {
      this.fail(run, 'fix', e);
    }
  }

  /** A stage threw: finish the run with the error (a no-op after Stop, which finishes the run itself). */
  private fail(run: RunRecord, stage: 'run' | 'fix', e: unknown): void {
    if (this.lifecycle(run).stopped) return;
    this.d.log?.(`${stage} ${run.id} failed: ${String((e as Error)?.stack ?? e)}`);
    this.lifecycle(run).finish('error', String((e as Error)?.message ?? e).slice(0, 300));
  }

  /** Screen-reader readout of a finding's region, a live sandbox's page, or the agent's last AX view. */
  async listen(runId: string, opts: { agent?: AgentId; cssPath?: string; findingId?: string }): Promise<{ audioUrl: string; script: string } | null> {
    const run = this.d.store.get(runId);
    if (!run) return null;
    let nodes: AxNodeView[] | undefined;
    if (opts.findingId) nodes = run.findings.find((f) => f.id === opts.findingId)?.evidence.blindExcerpt;
    const agent = opts.agent ?? 'blind';
    if (!nodes?.length) {
      const live = run.lifecycle?.liveSandbox(agent);
      if (live) nodes = await live.rpc.call({ m: 'axSpeech', cssPath: opts.cssPath }).catch(() => undefined);
    }
    if (!nodes?.length) nodes = run.lastAx.get(agent) ?? run.lastAx.get('blind');
    const script = speechScript(nodes ?? []);
    if (!script) return null;
    const { id } = await this.d.synth(script);
    return { audioUrl: `/api/audio/${id}.mp3`, script };
  }
}
