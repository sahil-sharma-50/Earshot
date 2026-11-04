import type { RunEvent } from '@earshot/shared';
import type { RunStore } from './store.js';

export function runIdOf(e: RunEvent): string {
  return e.t === 'finding' ? e.finding.runId : e.runId;
}

type Listener = (e: RunEvent) => void;

/** Per-run pub/sub. Every event is recorded on the run so late subscribers get a full replay. */
export class RunBus {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private readonly store: RunStore) {}

  publish(e: RunEvent): void {
    const runId = runIdOf(e);
    const run = this.store.get(runId);
    // after Stop, only sandbox teardown and the final event still reach viewers
    if (run?.control?.stopped && e.t !== 'sandbox.destroyed' && e.t !== 'run.finished') return;
    if (run) {
      run.events.push(e);
      if (e.t === 'step' && e.axExcerpt?.length) run.lastAx.set(e.agent, e.axExcerpt);
      if (e.t === 'finding') {
        const i = run.findings.findIndex((f) => f.id === e.finding.id);
        if (i >= 0) run.findings[i] = e.finding;
        else run.findings.push(e.finding);
      }
      if (e.t === 'run.finished') run.phase = 'finished';
    }
    for (const l of this.listeners.get(runId) ?? []) {
      try { l(e); } catch { /* a broken subscriber never breaks the run */ }
    }
  }

  /** Replays recorded events, then streams live ones. Returns an unsubscribe function. */
  subscribe(runId: string, listener: Listener): () => void {
    for (const e of this.store.get(runId)?.events ?? []) listener(e);
    let set = this.listeners.get(runId);
    if (!set) this.listeners.set(runId, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(runId);
    };
  }
}
