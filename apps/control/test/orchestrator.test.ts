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

test('any-url sandboxes get the any-url proxy policy with an empty allowlist', async () => {
  const s = setup();
  const run = s.store.create({ mode: 'any-url', goal: 'find the returns policy', startUrl: 'https://example.com/', allowHosts: [] });
  const opts: unknown[] = [];
  const orig = (s.orch as any).d.createSandbox;
  (s.orch as any).d.createSandbox = async (o: unknown) => { opts.push(o); return orig(o); };
  const done = s.finished(run.id);
  s.orch.start(run);
  await done;
  expect(opts).toContainEqual({ runId: run.id, agent: 'sighted', mode: 'any-url', allowHosts: [] });
  expect(opts).toContainEqual({ runId: run.id, agent: 'blind', mode: 'any-url', allowHosts: [] });
  expect(s.orch.requestFix(run.id, s.approvals.issueToken(run.id))).toBe('not-ready');
});

const STOP_ERROR = 'Stopped by the person who started this run';

/** Agents that keep stepping (through the pause/stop checkpoint) until released. */
function looping(s: ReturnType<typeof setup>) {
  let release = false;
  s.runAgentFn.mockImplementation(async (ctx: AgentContext): Promise<AgentResult> => {
    for (;;) {
      await ctx.checkpoint?.();
      if (release) return { outcome: 'gate', steps: [], milestones: [] };
      await new Promise((r) => setTimeout(r, 5));
    }
  });
  return () => { release = true; };
}

test('stopRun while agents run destroys live sandboxes with reason stopped and finishes with the stop error', async () => {
  const s = setup();
  looping(s);
  const run = s.spec();
  const token = s.approvals.issueToken(run.id);
  const done = s.finished(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => run.live.size === 2);
  expect(await s.orch.stopRun(run.id, token)).toBe('ok');
  expect(await done).toMatchObject({ verified: false, error: STOP_ERROR });
  await vi.waitUntil(() => s.destroyed.length === 2);
  expect(s.destroyed.sort()).toEqual(['blind:stopped', 'sighted:stopped']);
  expect(s.attributeFn).not.toHaveBeenCalled();
});

test('stopRun resolves a pending approval as denied', async () => {
  const s = setup();
  let decision: string | undefined;
  s.runAgentFn.mockImplementation(async (ctx: AgentContext): Promise<AgentResult> => {
    if (ctx.kind === 'sighted') decision = await ctx.gate({ cssPath: 'b', backendNodeId: 1, snippet: '<button>', isFinal: true, isFormSubmit: true });
    for (;;) { await ctx.checkpoint?.(); await new Promise((r) => setTimeout(r, 5)); }
  });
  const run = s.spec();
  const token = s.approvals.issueToken(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => run.events.some((e) => e.t === 'approval.requested'));
  await s.orch.stopRun(run.id, token);
  await vi.waitUntil(() => decision !== undefined);
  expect(decision).toBe('denied');
});

test('stopRun on a queued run removes it and finishes', async () => {
  const s = setup();
  const release = looping(s);
  const first = s.spec();
  s.orch.start(first);
  const second = s.spec();
  const token = s.approvals.issueToken(second.id);
  const done = s.finished(second.id);
  s.orch.start(second);
  expect(second.phase).toBe('queued');
  expect(await s.orch.stopRun(second.id, token)).toBe('ok');
  expect(await done).toMatchObject({ error: STOP_ERROR });
  release();
  await vi.waitUntil(() => first.phase === 'awaiting-fix');
  expect(s.created.filter((a) => a === 'sighted')).toHaveLength(1);
});

test('pauseRun returns not-ready when phase is awaiting-fix and not-allowed with a wrong token', async () => {
  const s = setup();
  const run = s.spec();
  const token = s.approvals.issueToken(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => run.phase === 'awaiting-fix');
  expect(s.orch.pauseRun(run.id, token)).toBe('not-ready');
  expect(s.orch.pauseRun(run.id, 'wrong')).toBe('not-allowed');
  expect(s.orch.pauseRun('nope', token)).toBe('not-found');
});

test('pauseRun and resumeRun while agents run', async () => {
  const s = setup();
  const release = looping(s);
  const run = s.spec();
  const token = s.approvals.issueToken(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => run.live.size === 2);
  expect(s.orch.pauseRun(run.id, token)).toBe('ok');
  expect(s.orch.resumeRun(run.id, token)).toBe('ok');
  expect(s.orch.resumeRun(run.id, token)).toBe('not-ready');
  release();
  await vi.waitUntil(() => run.phase === 'awaiting-fix');
  expect(run.events.filter((e) => e.t === 'run.paused' || e.t === 'run.resumed').map((e) => e.t)).toEqual(['run.paused', 'run.resumed']);
});

test('run.phase events are emitted in order queued, running, awaiting-fix (with fixDeadlineAt), fixing, finished', async () => {
  const s = setup();
  const run = s.spec();
  const token = s.approvals.issueToken(run.id);
  const done = s.finished(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => run.phase === 'awaiting-fix');
  s.orch.requestFix(run.id, token);
  await done;
  const phases = run.events.filter((e) => e.t === 'run.phase') as Extract<RunEvent, { t: 'run.phase' }>[];
  expect(phases.map((p) => p.phase)).toEqual(['queued', 'running', 'awaiting-fix', 'fixing', 'finished']);
  expect(phases[2]!.fixDeadlineAt).toBeGreaterThan(Date.now());
  expect(run.events.findIndex((e) => e.t === 'run.phase' && e.phase === 'finished')).toBeLessThan(run.events.findIndex((e) => e.t === 'run.finished'));
});

test('events after stop are dropped except sandbox.destroyed and run.finished', async () => {
  const s = setup();
  looping(s);
  const run = s.spec();
  const token = s.approvals.issueToken(run.id);
  s.orch.start(run);
  await vi.waitUntil(() => run.live.size === 2);
  await s.orch.stopRun(run.id, token);
  const n = run.events.length;
  s.bus.publish({ t: 'step', runId: run.id, agent: 'blind', index: 9, url: '', reasoning: '', action: { type: 'done' }, result: { ok: true }, milestones: [] });
  s.bus.publish({ t: 'sandbox.destroyed', runId: run.id, agent: 'inspector', containerId: 'x', reason: 'stopped' });
  expect(run.events.slice(n).map((e) => e.t)).toEqual(['sandbox.destroyed']);
});
