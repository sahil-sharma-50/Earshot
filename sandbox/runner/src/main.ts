import { pathToFileURL } from 'node:url';
import { createLineDecoder, encode, type RpcRequest, type RpcResponse } from '@earshot/shared';
import { Runner } from './runner.js';

export { Runner };

/**
 * stdio JSON-lines RPC loop. stdout carries ONLY protocol frames; every log goes to stderr.
 * Requests are handled one at a time, in order.
 */
export function serveStdio(runner = new Runner()): void {
  console.log = console.error;
  console.info = console.error;
  console.warn = console.error;
  let chain = Promise.resolve();
  const send = (msg: RpcResponse) => process.stdout.write(encode(msg));
  const feed = createLineDecoder((raw) => {
    const req = raw as RpcRequest;
    chain = chain.then(async () => {
      try {
        const result = await runner.handle(req);
        send({ id: req.id, ok: true, result: result ?? null });
        if (req.m === 'close') process.exit(0);
      } catch (e) {
        send({ id: req.id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 500) });
      }
    });
  });
  process.stdin.on('data', feed);
  process.stdin.on('end', () => { void runner.shutdown().finally(() => process.exit(0)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serveStdio();
