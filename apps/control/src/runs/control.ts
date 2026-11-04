import type { RunEvent } from '@earshot/shared';

/** A paused run resumes on its own after this long; sandbox hard caps keep running meanwhile. */
export const PAUSE_MAX_MS = 30_000;

export class StoppedError extends Error {
  constructor() { super('run stopped'); }
}

/** Per-run pause gate and stop flag. Agents and stages call `checkpoint()` between steps. */
export class RunControl {
  private _paused = false;
  private _stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private waiters: Array<() => void> = [];

  constructor(private readonly emit: (e: RunEvent) => void, private readonly runId: string, private readonly maxPauseMs = PAUSE_MAX_MS) {}

  get paused(): boolean { return this._paused; }
  get stopped(): boolean { return this._stopped; }

  pause(): boolean {
    if (this._paused || this._stopped) return false;
    this._paused = true;
    const resumeAt = Date.now() + this.maxPauseMs;
    this.timer = setTimeout(() => this.resume('auto'), this.maxPauseMs);
    this.timer.unref?.();
    this.emit({ t: 'run.paused', runId: this.runId, resumeAt });
    return true;
  }

  resume(by: 'user' | 'auto'): boolean {
    if (!this._paused || this._stopped) return false;
    this.release();
    this.emit({ t: 'run.resumed', runId: this.runId, by });
    return true;
  }

  stop(): void {
    if (this._stopped) return;
    this._stopped = true;
    this.release();
  }

  async checkpoint(): Promise<void> {
    if (this._stopped) throw new StoppedError();
    if (this._paused) await new Promise<void>((r) => this.waiters.push(r));
    if (this._stopped) throw new StoppedError();
  }

  private release(): void {
    this._paused = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
}
