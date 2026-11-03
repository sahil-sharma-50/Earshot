import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { AgentId, ElementIdentity, RunEvent } from '@earshot/shared';

export type Decision = 'approved' | 'denied' | 'timeout';
export type ResolveResult = 'ok' | 'forbidden' | 'already-resolved' | 'not-found';

interface Pending { runId: string; done: boolean; finish: (d: Decision) => void }

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Final-purchase approvals. Only the holder of the run's starter token can decide; silence for 60 s = denied (timeout). */
export class Approvals {
  private tokens = new Map<string, Buffer>(); // runId → sha256(token)
  private pending = new Map<string, Pending>();

  constructor(private readonly emit: (e: RunEvent) => void, private readonly timeoutMs = 60_000) {}

  issueToken(runId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.tokens.set(runId, digest(token));
    return token;
  }

  request(runId: string, agent: AgentId, element: ElementIdentity): Promise<Decision> {
    const approvalId = randomBytes(9).toString('base64url');
    return new Promise<Decision>((resolve) => {
      const entry: Pending = {
        runId,
        done: false,
        finish: (d) => {
          if (entry.done) return;
          entry.done = true;
          clearTimeout(timer);
          this.emit({ t: 'approval.resolved', runId, approvalId, decision: d });
          resolve(d);
        },
      };
      const timer = setTimeout(() => entry.finish('timeout'), this.timeoutMs);
      this.pending.set(approvalId, entry);
      this.emit({ t: 'approval.requested', runId, agent, approvalId, element });
    });
  }

  resolve(runId: string, approvalId: string, token: string, decision: 'approved' | 'denied'): ResolveResult {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.runId !== runId) return 'not-found';
    const expected = this.tokens.get(runId);
    // compare fixed-length digests in constant time
    if (!expected || !token || !timingSafeEqual(digest(token), expected)) return 'forbidden';
    if (entry.done) return 'already-resolved';
    entry.finish(decision);
    return 'ok';
  }

  /** True when `token` is the starter token of `runId` (constant time). */
  checkToken(runId: string, token: string): boolean {
    const expected = this.tokens.get(runId);
    return !!expected && !!token && timingSafeEqual(digest(token), expected);
  }

  /** Drops a finished run's token and settled approvals. */
  forget(runId: string): void {
    this.tokens.delete(runId);
    for (const [id, p] of this.pending) if (p.runId === runId && p.done) this.pending.delete(id);
  }
}
