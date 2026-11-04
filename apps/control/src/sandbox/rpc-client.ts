import type { Readable } from 'node:stream';
import { createLineDecoder, encode, type RpcCall, type RpcRequest, type RpcResponse, type RpcResult } from '@earshot/shared';

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

/** Control-side end of the stdio JSON-lines RPC to a sandbox runner. */
export class RpcClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closedReason: string | null = null;

  constructor(private readonly stdin: { write(chunk: string): unknown }, stdout: Readable) {
    const feed = createLineDecoder((raw) => {
      const msg = raw as RpcResponse;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    stdout.on('data', (chunk: Buffer | string) => {
      try { feed(chunk); } catch { /* a malformed frame is ignored; the call times out */ }
    });
    stdout.on('end', () => this.close('runner exited'));
    stdout.on('close', () => this.close('runner exited'));
    stdout.on('error', () => this.close('runner exited'));
  }

  /** Sends one call; the reply type follows from the method (see RpcMethods). */
  call<C extends RpcCall>(req: C, timeoutMs = 30_000): Promise<RpcResult<C['m']>> {
    if (this.closedReason) return Promise.reject(new Error(this.closedReason));
    const id = this.nextId++;
    return new Promise<RpcResult<C['m']>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${req.m}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.stdin.write(encode({ ...req, id } as RpcRequest));
    });
  }

  close(reason = 'runner exited'): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
