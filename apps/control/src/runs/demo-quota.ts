/**
 * Demo and drill runs per IP: at most `max` in any rolling window. A run its starter stops early
 * gives its slot back, so stopping a run you no longer need never locks you out.
 */
export class DemoQuota {
  private readonly starts = new Map<string, { runId: string; at: number }[]>();
  private readonly ipOf = new Map<string, string>();

  constructor(
    private readonly max = 3,
    private readonly windowMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** null when this IP may start a run now; otherwise the time (ms) the next slot frees up. */
  check(ip: string): number | null {
    const live = this.prune(ip);
    return live.length < this.max ? null : live[live.length - this.max]!.at + this.windowMs;
  }

  record(ip: string, runId: string): void {
    this.prune(ip).push({ runId, at: this.now() });
    this.ipOf.set(runId, ip);
  }

  /** The starter stopped this run: it no longer counts. */
  release(runId: string): void {
    const ip = this.ipOf.get(runId);
    if (!ip) return;
    this.ipOf.delete(runId);
    this.starts.set(ip, (this.starts.get(ip) ?? []).filter((s) => s.runId !== runId));
  }

  private prune(ip: string): { runId: string; at: number }[] {
    const since = this.now() - this.windowMs;
    const kept = (this.starts.get(ip) ?? []).filter((s) => s.at > since);
    for (const s of this.starts.get(ip) ?? []) if (s.at <= since) this.ipOf.delete(s.runId);
    this.starts.set(ip, kept);
    return kept;
  }
}
