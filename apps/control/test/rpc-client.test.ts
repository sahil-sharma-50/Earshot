import { expect, test } from 'vitest';
import { PassThrough } from 'node:stream';
import { createLineDecoder, encode, type RpcRequest } from '@earshot/shared';
import { RpcClient } from '../src/sandbox/rpc-client.js';

function harness() {
  const toRunner = new PassThrough();
  const fromRunner = new PassThrough();
  const seen: RpcRequest[] = [];
  toRunner.on('data', createLineDecoder((m) => seen.push(m as RpcRequest)));
  return { client: new RpcClient(toRunner, fromRunner), fromRunner, seen };
}

test('concurrent calls resolve by id', async () => {
  const { client, fromRunner, seen } = harness();
  const a = client.call<{ v: string }>({ m: 'probe' });
  const b = client.call<{ v: string }>({ m: 'patchStatus' });
  await new Promise((r) => setImmediate(r));
  expect(seen.map((s) => s.m)).toEqual(['probe', 'patchStatus']);
  fromRunner.write(encode({ id: seen[1]!.id, ok: true, result: { v: 'b' } }));
  fromRunner.write(encode({ id: seen[0]!.id, ok: true, result: { v: 'a' } }));
  expect(await a).toEqual({ v: 'a' });
  expect(await b).toEqual({ v: 'b' });
});

test('ok:false rejects with the error string', async () => {
  const { client, fromRunner, seen } = harness();
  const p = client.call({ m: 'observe', kind: 'blind' });
  await new Promise((r) => setImmediate(r));
  fromRunner.write(encode({ id: seen[0]!.id, ok: false, error: 'no page open' }));
  await expect(p).rejects.toThrow('no page open');
});

test('timeout rejects with rpc timeout: <method>', async () => {
  const { client } = harness();
  await expect(client.call({ m: 'observe', kind: 'blind' }, 30)).rejects.toThrow('rpc timeout: observe');
});

test('runner exit rejects every pending call', async () => {
  const { client, fromRunner } = harness();
  const p = client.call({ m: 'probe' });
  fromRunner.end();
  await expect(p).rejects.toThrow(/runner exited/);
  await expect(client.call({ m: 'probe' })).rejects.toThrow(/runner exited/);
});
