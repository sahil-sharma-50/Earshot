import { vi } from 'vitest';
import type { RpcCall, RpcMethod, RpcResult } from '@earshot/shared';
import type { DestroyReason, Sandbox, SandboxOpts } from '../src/sandbox/docker.js';
import type { RpcClient } from '../src/sandbox/rpc-client.js';

/**
 * The one fake runner for control tests, typed by the runner's method table. A handler gets the
 * typed request and returns the typed reply. A method without a handler throws, except the
 * plumbing calls (`open`, `patchStatus`, `close`), which answer with an empty reply.
 */
export type RpcHandlers = { [M in RpcMethod]?: (req: RpcCall<M>) => RpcResult<M> | Promise<RpcResult<M>> };

const PLUMBING: RpcHandlers = {
  open: () => ({ url: '', title: '' }),
  patchStatus: () => ({}),
  close: () => ({ closed: true }),
};

export interface FakeSandbox extends Sandbox { calls: RpcCall[] }

export function fakeSandbox(opts: Pick<SandboxOpts, 'agent'> & Partial<SandboxOpts>, handlers: RpcHandlers = {}, onDestroy?: (reason: DestroyReason) => void, id = `c-${opts.agent}`): FakeSandbox {
  const calls: RpcCall[] = [];
  const all = { ...PLUMBING, ...handlers } as Record<string, ((req: RpcCall) => unknown) | undefined>;
  const rpc = {
    call: async (req: RpcCall) => {
      calls.push(req);
      const h = all[req.m];
      if (!h) throw new Error(`fake sandbox: no handler for ${req.m}`);
      return h(req);
    },
  } as unknown as RpcClient;
  const sb: FakeSandbox = {
    id, ip: '10.0.0.2', agent: opts.agent, limits: {} as never, destroyed: false, rpc, calls,
    destroy: async (reason) => { sb.destroyed = true; onDestroy?.(reason); },
  };
  return sb;
}

/**
 * A CreateSandbox that hands out fake sandboxes. `handlers` may depend on the options and on the
 * sandbox's number (0, 1, …). `destroyed` records `<id>:<reason>`.
 */
export function fakeSandboxes(handlers: RpcHandlers | ((opts: SandboxOpts, n: number) => RpcHandlers) = {}, hooks: { created?: (o: SandboxOpts) => void; destroyed?: (o: SandboxOpts, reason: DestroyReason) => void } = {}) {
  const created: SandboxOpts[] = [];
  const destroyed: string[] = [];
  const sandboxes: FakeSandbox[] = [];
  const createSandbox = vi.fn(async (o: SandboxOpts) => {
    const n = created.length;
    created.push(o);
    hooks.created?.(o);
    const sb = fakeSandbox(o, typeof handlers === 'function' ? handlers(o, n) : handlers, (reason) => {
      destroyed.push(`${sb.id}:${reason}`);
      hooks.destroyed?.(o, reason);
    }, `c${n}`);
    sandboxes.push(sb);
    return sb as Sandbox;
  });
  return { createSandbox, created, destroyed, sandboxes, calls: () => sandboxes.flatMap((s) => s.calls) };
}
