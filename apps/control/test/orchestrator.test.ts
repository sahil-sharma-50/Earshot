import { expect, test, vi } from 'vitest';
import type { Finding, RpcCall, RunEvent } from '@earshot/shared';
import { Orchestrator, type RunSpec } from '../src/runs/orchestrator.js';
import { RunStore } from '../src/runs/store.js';
import { RunBus } from '../src/runs/events.js';
import { Approvals } from '../src/runs/approval.js';
import { RunQueue } from '../src/runs/queue.js';
import type { AgentContext, AgentResult } from '../src/agents/loop.js';
import type { Sandbox, SandboxOpts } from '../src/sandbox/docker.js';
import type { Inference } from '../src/inference/client.js';

const finding = (confirmed = true): Finding => ({
  id: 'f1', runId: 'r1', milestone: 'grind_selected', element: { cssPath: '.g', backendNodeId: 1, snippet: '<div>', isFinal: false, isFormSubmit: false },
  categories: confirmed ? ['wrong-role'] : [], axeRules: [], wcag: ['4.1.2'], confirmed, evidence: { sightedStep: 1, blindLastStep: 1, blindExcerpt: [] }, status: 'open',
});

function setup(opts: { blindThrows?: boolean; finding?: Finding | null; fixVerified?: boolean } = {}) {
  const store = new RunStore();
  const bus = new RunBus(store);
  const approvals = new Approvals((e) => bus.publish(e));
  const created: string[] = [];
  const destroyed: string[] = [];
  const createSandbox = vi.fn(async (o: SandboxOpts) => {
    created.push(o.agent);
    return {
      id: `c-${o.agent}`, ip: '10.0.0.1', agent: o.agent, destroyed: false, limits: {} as never,
      rpc: { call: async (_r: RpcCall) => ({}) },
      destroy: async (reason: string) => { destroyed.push(`${o.agent}:${reason}`); },
    } as unknown as Sandbox;
  });
  const runAgentFn = vi.fn(async (ctx: AgentContext): Promise<AgentResult> => {
    if (ctx.kind === 'blind' && opts.blindThrows) throw new Error('runner crashed');
    return ctx.kind === 'sighted'
      ? { outcome: 'gate', steps: [], milestones: ['on_product_page', 'grind_selected'] }
      : { outcome: 'no-progress', steps: [], milestones: ['on_product_page'] };
  });
  const attributeFn = vi.fn(async () => (opts.finding === undefined ? finding() : opts.finding));
  const runFixLoopFn = vi.fn(async () => ({ verified: opts.fixVerified ?? true, patches: [], findings: [] }));
  const orch = new Orchestrator({
    store, bus, approvals, queue: new RunQueue((e) => bus.publish(e)), createSandbox, inference: {} as Inference,
    storeUrl: 'http://store:8080', runAgentFn, attributeFn, runFixLoopFn, synth: Object.assign(async () => ({ id: 'a', mp3: Buffer.alloc(0) }), { get: () => undefined }),
  });
  const spec = (mode: RunSpec['mode'] = 'demo'): RunSpec => {
    const run = store.create({ mode, goal: 'g', startUrl: 'http://store:8080/', allowHosts: ['store:8080'] });
    bus.publish({ t: 'run.created', runId: run.id, mode, goal: 'g', target: run.startUrl });
    return run;
  };
  const finished = (runId: string) => new Promise<Extract<RunEvent, { t: 'run.finished' }>>((resolve) => {
    bus.subscribe(runId, (e) => { if (e.t === 'run.finished') resolve(e); });
  });
  return { store, bus, approvals, orch, created, destroyed, spec, finished, runAgentFn, attributeFn, runFixLoopFn };
}

test('orchestrator destroys all sandboxes when blind agent throws', async () => {
  const s = setup({ blindThrows: true });
  const run = s.spec();
  const done = s.finished(run.id);
  s.orch.start(run);
  const fin = await done;
  expect(fin).toMatchObject({ verified: false });
  expect(fin.error).toContain('runner crashed');
  expect(s.created.sort()).toEqual(['blind', 'sighted']);
  expect(s.destroyed.sort()).toEqual(['blind:error', 'sighted:finished']);
});

test('demo: confirmed finding waits for Fix & verify, then runs the fix loop', async () => {
  const s = setup();
  const run = s.spec();
  const done = s.finished(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => s.store.get(run.id)!.phase === 'awaiting-fix');
  expect(s.runFixLoopFn).not.toHaveBeenCalled();
  const token = s.approvals.issueToken(run.id);
  expect(s.orch.requestFix(run.id, token)).toBe('ok');
  expect(s.orch.requestFix(run.id, token)).toBe('not-ready');
  expect(await done).toMatchObject({ verified: true });
  expect(s.runFixLoopFn).toHaveBeenCalledOnce();
  expect((s.runFixLoopFn.mock.calls[0] as any)[0]).toMatchObject({ startUrl: 'http://store:8080/', firstFinding: { id: 'f1' } });
});

test('requestFix with a wrong token is not allowed', async () => {
  const s = setup();
  const run = s.spec();
  s.approvals.issueToken(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => s.store.get(run.id)!.phase === 'awaiting-fix');
  expect(s.orch.requestFix(run.id, 'wrong')).toBe('not-allowed');
});

test('inconclusive finding finishes the run without a fix loop', async () => {
  const s = setup({ finding: finding(false) });
  const run = s.spec();
  const done = s.finished(run.id);
  s.orch.start(run);
  expect(await done).toMatchObject({ verified: false });
  expect(s.runFixLoopFn).not.toHaveBeenCalled();
});

test('any-url: findings only, no fix loop, empty allowlist', async () => {
  const s = setup();
  const run = s.store.create({ mode: 'any-url', goal: 'g', startUrl: 'https://example.com/', allowHosts: [] });
  const done = s.finished(run.id);
  s.orch.start(run);
  await done;
  expect(s.runFixLoopFn).not.toHaveBeenCalled();
  expect(s.store.get(run.id)!.phase).toBe('finished');
});

test('blind reaching the gate with no divergence is verified without fixes', async () => {
  const s = setup({ finding: null });
  s.runAgentFn.mockImplementation(async () => ({ outcome: 'gate', steps: [], milestones: ['on_product_page'] }));
  const run = s.spec();
  const done = s.finished(run.id);
  s.orch.start(run);
  expect(await done).toMatchObject({ verified: true });
});
