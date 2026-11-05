import type { Action, ActResult, AgentKind, AxNodeView, ElementIdentity, ElementReport, Observation, Probe } from './types.js';
import type { Patch, PatchReport } from './patch.js';

/**
 * The runner's method table: request fields and reply per method. Control-side calls and the
 * runner's dispatcher are both typed from it.
 */
export interface RpcMethods {
  open: { req: { url: string; patches: Patch[]; seed?: 'drill' }; res: { url: string; title: string } };
  observe: { req: { kind: AgentKind }; res: Observation };
  act: { req: { kind: AgentKind; action: Action }; res: ActResult };
  describe: { req: { kind: AgentKind; target: string }; res: ElementIdentity };
  probe: { req: object; res: Probe };
  replay: { req: { actions: { cssPath: string; action: Action }[] }; res: { replayed: number } };
  inspect: { req: { cssPath: string }; res: ElementReport };
  patchStatus: { req: object; res: Record<string, PatchReport> };
  axSpeech: { req: { cssPath?: string }; res: AxNodeView[] };
  close: { req: object; res: { closed: true } };
}
export type RpcMethod = keyof RpcMethods;

/**
 * Methods that never change the page. Only these are retried when they race a navigation; an action
 * could run twice. A Record so that every new method must say which it is.
 */
export const READ_ONLY_METHODS: Readonly<Record<RpcMethod, boolean>> = {
  open: false, observe: true, act: false, describe: true, probe: true,
  replay: false, inspect: false, patchStatus: true, axSpeech: true, close: false,
};

/** One call: the method name plus its request fields (no id). */
export type RpcCall<M extends RpcMethod = RpcMethod> = M extends RpcMethod ? { m: M } & RpcMethods[M]['req'] : never;
export type RpcResult<M extends RpcMethod> = RpcMethods[M]['res'];
export type RpcRequest = { id: number } & RpcCall;
export type RpcResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

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
