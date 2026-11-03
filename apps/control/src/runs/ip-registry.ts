import type { AgentId } from '@earshot/shared';

/** Sandbox IP → {runId, agent}, so proxy BLOCKED reports land on the right run. */
export class IpRegistry {
  private map = new Map<string, { runId: string; agent: AgentId; at: number }>();

  set(ip: string, owner: { runId: string; agent: AgentId }): void {
    this.map.set(ip, { ...owner, at: Date.now() });
  }

  get(ip: string): { runId: string; agent: AgentId } | undefined {
    const v = this.map.get(ip);
    return v ? { runId: v.runId, agent: v.agent } : undefined;
  }

  /** Keep the mapping a little after destroy: a block report can race the teardown. */
  release(ip: string, graceMs = 30_000): void {
    const v = this.map.get(ip);
    if (!v) return;
    setTimeout(() => {
      if (this.map.get(ip) === v) this.map.delete(ip);
    }, graceMs).unref?.();
  }
}
