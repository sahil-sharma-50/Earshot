import { expect, test } from 'vitest';
import { leaseWith, destroyReasonOf, type LeaseOwner } from '../src/sandbox/lease.js';
import { StoppedError } from '../src/runs/control.js';
import type { Sandbox, SandboxOpts } from '../src/sandbox/docker.js';
import { fakeSandboxes } from './fakes.js';

const opts: SandboxOpts = { runId: 'r', agent: 'blind', mode: 'demo', allowHosts: [] };

/** Fake sandboxes; `destroyed` lists teardown reasons in order. */
function factory() {
  const destroyed: string[] = [];
  const f = fakeSandboxes({}, { destroyed: (_o, reason) => destroyed.push(reason) });
  return { create: f.createSandbox, destroyed, get created() { return f.created.length; } };
}

test('plain lease destroys with finished on success and error on throw', async () => {
  const f = factory();
  const lease = leaseWith(f.create);
  expect(await lease(opts, async () => 42)).toBe(42);
  await expect(lease(opts, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  expect(f.destroyed).toEqual(['finished', 'error']);
});

test('reasonOf maps the result to the teardown reason', async () => {
  const f = factory();
  await leaseWith(f.create)(opts, async () => 'timeout' as const, (r) => destroyReasonOf(r));
  expect(f.destroyed).toEqual(['timeout']);
});

test('a StoppedError from the job tears down as stopped', async () => {
  const f = factory();
  await expect(leaseWith(f.create)(opts, async () => { throw new StoppedError(); })).rejects.toBeInstanceOf(StoppedError);
  expect(f.destroyed).toEqual(['stopped']);
});

test('an owned lease refuses after stop, registers while held and releases through its owner', async () => {
  const f = factory();
  const held: string[] = [];
  const owner: LeaseOwner & { stopped: boolean } = {
    stopped: false,
    acquired: (a) => { held.push(a); },
    release: (a, sb, r) => { held.splice(held.indexOf(a), 1); return sb.destroy(r); },
  };
  const lease = leaseWith(f.create, owner);
  await lease(opts, async () => { expect(held).toEqual(['blind']); });
  expect(held).toEqual([]);
  owner.stopped = true;
  await expect(lease(opts, async () => 1)).rejects.toBeInstanceOf(StoppedError);
  expect(f.created).toBe(1);
});

test('a stop that lands while the sandbox is being created destroys it as stopped', async () => {
  const f = factory();
  const owner = { stopped: false, acquired: () => {}, release: (_a: string, sb: Sandbox, r: never) => sb.destroy(r) } as LeaseOwner & { stopped: boolean };
  const lease = leaseWith(async (o) => { const sb = await f.create(o); owner.stopped = true; return sb; }, owner);
  await expect(lease(opts, async () => 1)).rejects.toBeInstanceOf(StoppedError);
  expect(f.destroyed).toEqual(['stopped']);
});
