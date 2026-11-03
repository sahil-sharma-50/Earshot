import type { Action, AgentKind, Patch } from './types.js';

export type RpcRequest = { id: number } & (
  | { m: 'open'; url: string; patches: Patch[]; seed?: 'drill' }
  | { m: 'observe'; kind: AgentKind }
  | { m: 'act'; kind: AgentKind; action: Action }
  | { m: 'describe'; kind: AgentKind; target: string }
  | { m: 'probe' }
  | { m: 'replay'; actions: { cssPath: string; action: Action }[] }
  | { m: 'inspect'; cssPath: string }
  | { m: 'patchStatus' }
  | { m: 'axSpeech'; cssPath?: string }
  | { m: 'close' });
export type RpcResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** The request union without `id`, distributed over every member. */
export type RpcCall = RpcRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export function encode(msg: RpcRequest | RpcResponse): string {
  return JSON.stringify(msg) + '\n';
}

/** Feeds raw stream chunks; calls onMsg once per complete JSON line. Handles partial lines. */
export function createLineDecoder(onMsg: (m: unknown) => void): (chunk: Buffer | string) => void {
  let buf = '';
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onMsg(JSON.parse(line));
    }
  };
}
