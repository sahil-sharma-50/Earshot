import { isPausableAgent, type AgentId, type RunEvent, type RunOutcome, type RunPhase } from '@earshot/shared';
import type { CreateSandbox, DestroyReason, Sandbox } from '../sandbox/docker.js';
import { leaseWith, type LeaseSandbox } from '../sandbox/lease.js';
import { RunControl } from './control.js';
import type { RunRecord } from './store.js';

export const FIX_WAIT_MS = 10 * 60_000;
export const STOP_TEARDOWN_MS = 10_000;
/** run.finished.error shown when the starter pressed Stop. Clients read `outcome`, never this text. */
export const STOP_MESSAGE = 'Stopped by the person who started this run';

export type ControlResult = 'ok' | 'not-ready';

export interface LifecycleDeps {
  emit: (e: RunEvent) => void;
  createSandbox: CreateSandbox;
  /** Called once when Stop is pressed, before teardown (drop the queued job, deny approvals). */
  onStop?: () => void;
  /** Called once after run.finished. */
  onFinish?: () => void;
  fixWaitMs?: number;
  stopTeardownMs?: number;
  maxPauseMs?: number;
}

const NEXT: Record<RunPhase, readonly RunPhase[]> = {
  queued: ['running', 'finished'],
  running: ['awaiting-fix', 'finished'],
  'awaiting-fix': ['fixing', 'finished'],
  fixing: ['awaiting-fix', 'finished'],
  finished: [],
};

/** After Stop, viewers only see the teardown of sandboxes they saw created, approval outcomes and the end. */
const AFTER_STOP = new Set<RunEvent['t']>(['approval.resolved', 'run.phase', 'run.finished']);

/**
 * Owns one run's lifecycle: the phase transition table, pause and stop, the Fix & verify deadline,
 * the live sandboxes (handed out as leases) and which events still reach viewers after Stop.
 */
export class RunLifecycle {
  private readonly control: RunControl;
  private readonly live = new Map<AgentId, Sandbox>();
  private readonly teardowns = new WeakMap<Sandbox, Promise<void>>();
  private readonly announced = new Set<string>();
  private fixTimer: NodeJS.Timeout | undefined;
  private fixDeadlineAt: number | undefined;
  readonly lease: LeaseSandbox;

  constructor(private readonly run: RunRecord, private readonly d: LifecycleDeps) {
    this.control = new RunControl(d.emit, run.id, d.maxPauseMs);
    const lifecycle = this;
    this.lease = leaseWith(d.createSandbox, {
      get stopped() { return lifecycle.stopped; },
      acquired: (agent, sb) => { lifecycle.live.set(agent, sb); },
      release: (agent, sb, reason) => lifecycle.release(agent, sb, reason),
    });
  }

  get phase(): RunPhase { return this.run.phase; }
  get stopped(): boolean { return this.control.stopped; }
  get paused(): boolean { return this.control.paused; }
  liveAgents(): AgentId[] { return [...this.live.keys()]; }
  liveSandbox(agent: AgentId): Sandbox | undefined { return this.live.get(agent); }

  /** Agents and stages call this between steps: waits while paused, throws StoppedError after Stop. */
  checkpoint = (): Promise<void> => this.control.checkpoint();

  /** Announces the initial phase. */
  queued(): void {
    this.d.emit({ t: 'run.phase', runId: this.run.id, phase: 'queued' });
  }

  /** queued → running. False when the run was stopped (or already moved on) while it waited. */
  begin(): boolean {
    return !this.stopped && this.enter('running');
  }

  /** running → awaiting-fix, with a deadline after which the run finishes unverified. */
  awaitFix(): void {
    this.fixDeadlineAt = Date.now() + (this.d.fixWaitMs ?? FIX_WAIT_MS);
    if (this.enter('awaiting-fix')) this.armFixDeadline();
  }

  /** awaiting-fix → fixing. */
  beginFix(): boolean {
    if (this.stopped || !this.enter('fixing')) return false;
    this.clearFixDeadline();
    return true;
  }

  /** fixing → awaiting-fix when the fix could not be scheduled; the original deadline still holds. */
  abortFix(): void {
    if (this.enter('awaiting-fix')) this.armFixDeadline();
  }

  pause(): ControlResult {
    const agentLive = this.liveAgents().some(isPausableAgent);
    if ((this.phase !== 'running' && this.phase !== 'fixing') || !agentLive) return 'not-ready';
    return this.control.pause() ? 'ok' : 'not-ready';
  }

  resume(): ControlResult {
    return this.control.resume('user') ? 'ok' : 'not-ready';
  }

  /**
   * Immediate stop: every live sandbox is torn down (viewers close their stream on run.finished, so
   * teardown is published first, waiting at most STOP_TEARDOWN_MS), then the run finishes as stopped.
   */
  async stop(): Promise<ControlResult> {
    if (this.phase === 'finished' || this.stopped) return 'not-ready';
    this.control.stop();
    this.d.onStop?.();
    const teardown = Promise.all(this.liveAgents().map((a) => this.release(a, this.live.get(a)!, 'stopped').catch(() => undefined)));
    await Promise.race([teardown, new Promise((r) => setTimeout(r, this.d.stopTeardownMs ?? STOP_TEARDOWN_MS).unref?.())]);
    this.end('stopped', STOP_MESSAGE);
    return 'ok';
  }

  /** Ends the run. Ignored once finished, and ignored after Stop (Stop finishes the run itself). */
  finish(outcome: Exclude<RunOutcome, 'stopped'>, error?: string): void {
    if (this.stopped) return;
    this.end(outcome, error);
  }

  /** The bus asks before recording/broadcasting an event of this run. */
  admit(e: RunEvent): boolean {
    if (e.t === 'sandbox.created') {
      if (this.stopped) return false;
      this.announced.add(e.containerId);
      return true;
    }
    if (!this.stopped) return true;
    if (e.t === 'sandbox.destroyed') return this.announced.has(e.containerId);
    return AFTER_STOP.has(e.t);
  }

  /** Releases timers (run evicted from the store). */
  dispose(): void {
    this.clearFixDeadline();
  }

  private end(outcome: RunOutcome, error?: string): void {
    if (!this.enter('finished')) return;
    this.clearFixDeadline();
    const verified = outcome === 'verified';
    this.d.emit(error ? { t: 'run.finished', runId: this.run.id, outcome, verified, error } : { t: 'run.finished', runId: this.run.id, outcome, verified });
    this.d.onFinish?.();
  }

  private enter(phase: RunPhase): boolean {
    if (!NEXT[this.phase].includes(phase)) return false;
    this.run.phase = phase;
    const fixDeadlineAt = phase === 'awaiting-fix' ? this.fixDeadlineAt : undefined;
    this.d.emit(fixDeadlineAt ? { t: 'run.phase', runId: this.run.id, phase, fixDeadlineAt } : { t: 'run.phase', runId: this.run.id, phase });
    return true;
  }

  private armFixDeadline(): void {
    this.clearFixDeadline();
    const ms = Math.max(0, (this.fixDeadlineAt ?? Date.now()) - Date.now());
    this.fixTimer = setTimeout(() => {
      if (this.phase === 'awaiting-fix') this.finish('unverified');
    }, ms);
    this.fixTimer.unref?.();
  }

  private clearFixDeadline(): void {
    if (this.fixTimer) clearTimeout(this.fixTimer);
    this.fixTimer = undefined;
  }

  /** Destroys a sandbox exactly once, whoever asks first (its lease or Stop). */
  private release(agent: AgentId, sb: Sandbox, reason: DestroyReason): Promise<void> {
    if (this.live.get(agent) === sb) this.live.delete(agent);
    let t = this.teardowns.get(sb);
    if (!t) {
      t = sb.destroy(reason);
      this.teardowns.set(sb, t);
    }
    return t;
  }
}
