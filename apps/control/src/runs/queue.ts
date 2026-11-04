import type { RunEvent } from '@earshot/shared';

export class QueueFullError extends Error {
  constructor() { super('queue full'); }
}

interface Job { runId: string; fn: () => Promise<void> }

/** One job at a time; at most `max` waiting. Waiting runs get run.queued position updates. */
export class RunQueue {
  private waiting: Job[] = [];
  private running = false;

  constructor(private readonly emit: (e: RunEvent) => void, private readonly max = 5) {}

  get size(): number { return this.waiting.length + (this.running ? 1 : 0); }

  enqueue(runId: string, fn: () => Promise<void>): void {
    if (this.waiting.length >= this.max) throw new QueueFullError();
    this.waiting.push({ runId, fn });
    this.announce();
    void this.pump();
  }

  /** Removes a waiting (not yet running) job. */
  remove(runId: string): boolean {
    const i = this.waiting.findIndex((j) => j.runId === runId);
    if (i < 0) return false;
    this.waiting.splice(i, 1);
    this.announce();
    return true;
  }

  private announce(): void {
    const offset = this.running ? 1 : 0;
    this.waiting.forEach((j, i) => this.emit({ t: 'run.queued', runId: j.runId, position: i + offset }));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.waiting.shift();
    if (!job) return;
    this.running = true;
    this.announce();
    try {
      await job.fn();
    } catch {
      /* jobs report their own errors */
    } finally {
      this.running = false;
      void this.pump();
    }
  }
}
