import type { AgentId, AgentOutcome } from '@earshot/shared';
import { StoppedError } from '../runs/control.js';
import type { CreateSandbox, DestroyReason, Sandbox, SandboxOpts } from './docker.js';

/**
 * Borrow a fresh sandbox for one job. The sandbox is destroyed exactly once however `use` ends:
 * with `reasonOf(result)` (default `finished`), `stopped` when the run was stopped, `error` otherwise.
 */
export type LeaseSandbox = <T>(opts: SandboxOpts, use: (sb: Sandbox) => Promise<T>, reasonOf?: (result: T) => DestroyReason) => Promise<T>;

/** What a lease asks of its owner. The plain adapter has no owner: never stopped, destroy directly. */
export interface LeaseOwner {
  readonly stopped: boolean;
  acquired(agent: AgentId, sb: Sandbox): void;
  release(agent: AgentId, sb: Sandbox, reason: DestroyReason): Promise<void>;
}

const UNOWNED: LeaseOwner = {
  stopped: false,
  acquired() {},
  release: (_agent, sb, reason) => sb.destroy(reason),
};

export function leaseWith(create: CreateSandbox, owner: LeaseOwner = UNOWNED): LeaseSandbox {
  return async (opts, use, reasonOf) => {
    if (owner.stopped) throw new StoppedError();
    const sb = await create(opts);
    if (owner.stopped) {
      await sb.destroy('stopped');
      throw new StoppedError();
    }
    owner.acquired(opts.agent, sb);
    let reason: DestroyReason = 'error';
    try {
      const result = await use(sb);
      reason = owner.stopped ? 'stopped' : (reasonOf?.(result) ?? 'finished');
      return result;
    } catch (e) {
      if (owner.stopped || e instanceof StoppedError) reason = 'stopped';
      throw e;
    } finally {
      await owner.release(opts.agent, sb, reason);
    }
  };
}

/** The teardown reason that matches how an agent ended. */
export function destroyReasonOf(outcome: AgentOutcome): DestroyReason {
  return outcome === 'timeout' || outcome === 'error' || outcome === 'stopped' ? outcome : 'finished';
}
