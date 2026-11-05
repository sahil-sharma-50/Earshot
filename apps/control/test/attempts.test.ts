import { expect, test, vi } from 'vitest';
import type { ElementIdentity, Patch, RunEvent } from '@earshot/shared';
import { attemptsFor, type AttemptDeps, type RunScope } from '../src/runs/attempts.js';
import type { AgentContext, AgentResult } from '../src/agents/loop.js';
import { leaseWith } from '../src/sandbox/lease.js';
import { fakeSandboxes, type RpcHandlers } from './fakes.js';

const run: RunScope = { id: 'r1', mode: 'demo', goal: 'buy coffee', startUrl: 'http://store:8080/', allowHosts: ['store:8080'], seenInjectionTexts: new Set() };
const patch = (findingId: string): Patch => ({ findingId, selector: `.${findingId}`, attributes: { role: 'button' }, keyboardShim: false });
const gateResult: AgentResult = { outcome: 'gate', steps: [], milestones: ['on_product_page'] };

function setup(o: { handlers?: RpcHandlers; agent?: (ctx: AgentContext) => Promise<AgentResult> } = {}) {
  const sbx = fakeSandboxes(o.handlers ?? {});
  const events: RunEvent[] = [];
  const runAgentFn = vi.fn(o.agent ?? (async () => gateResult));
  const attributeFn = vi.fn(async () => null);
  const gate = vi.fn(async () => 'approved' as const);
  const deps: AttemptDeps = {
    lease: leaseWith(sbx.createSandbox), inference: {} as never, emit: (e) => events.push(e), storeShot: () => 'shot',
    gate, checkpoint: async () => {}, runAgentFn, attributeFn,
  };
  return { attempts: attemptsFor(run, deps), sbx, events, runAgentFn, attributeFn, gate, deps };
}

test('an attempt opens the start page in a fresh sandbox and runs the agent there', async () => {
  const s = setup();
  const a = await s.attempts.agent('sighted', 'sighted');
  expect(a).toEqual({ result: gateResult, patches: {} });
  expect(s.sbx.created).toEqual([{ runId: 'r1', agent: 'sighted', mode: 'demo', allowHosts: ['store:8080'] }]);
  expect(s.sbx.calls()).toEqual([{ m: 'open', url: 'http://store:8080/', patches: [] }]);
  const ctx = s.runAgentFn.mock.calls[0]![0];
  expect(ctx).toMatchObject({ runId: 'r1', agent: 'sighted', kind: 'sighted', mode: 'demo', goal: 'buy coffee', sandbox: s.sbx.sandboxes[0], seenInjectionTexts: run.seenInjectionTexts, checkpoint: s.deps.checkpoint });
  expect(s.sbx.destroyed).toEqual(['c0:finished']);
});

test('a patched attempt reports what each patch did', async () => {
  const s = setup({ handlers: { patchStatus: () => ({ f1: { matches: 4, applied: { role: 'button' } } }) } });
  const a = await s.attempts.agent('rerun-1', 'blind', [patch('f1')]);
  expect(s.sbx.calls()[0]).toEqual({ m: 'open', url: 'http://store:8080/', patches: [patch('f1')] });
  expect(a.patches).toEqual({ f1: { matches: 4, applied: { role: 'button' } } });
});

test('a failed patch report counts as no matches rather than failing the attempt', async () => {
  const s = setup({ handlers: { patchStatus: () => { throw new Error('page gone'); } } });
  expect((await s.attempts.agent('rerun-1', 'blind', [patch('f1')])).patches).toEqual({});
});

test('the gate is asked on behalf of the attempt’s agent', async () => {
  const el = { cssPath: 'button.final' } as ElementIdentity;
  const s = setup({ agent: async (ctx) => { await ctx.gate(el); return gateResult; } });
  await s.attempts.agent('rerun-2', 'blind');
  expect(s.gate).toHaveBeenCalledWith('rerun-2', el);
});

test.each<[AgentResult['outcome'], string]>([['timeout', 'c0:timeout'], ['stopped', 'c0:stopped'], ['no-progress', 'c0:finished']])(
  'a %s agent tears its sandbox down as %s', async (outcome, destroyed) => {
    const s = setup({ agent: async () => ({ outcome, steps: [], milestones: [] }) });
    await s.attempts.agent('blind', 'blind');
    expect(s.sbx.destroyed).toEqual([destroyed]);
  });

test('an agent that throws still destroys its sandbox, as error', async () => {
  const s = setup({ agent: async () => { throw new Error('boom'); } });
  await expect(s.attempts.agent('blind', 'blind')).rejects.toThrow('boom');
  expect(s.sbx.destroyed).toEqual(['c0:error']);
});

test('attribution runs with the run’s scope, lease and emitter', async () => {
  const s = setup();
  const blind: AgentResult = { outcome: 'no-progress', steps: [], milestones: [] };
  await s.attempts.attribute(gateResult, blind, [patch('f1')]);
  expect(s.attributeFn).toHaveBeenCalledWith({
    runId: 'r1', mode: 'demo', sighted: gateResult, blind, startUrl: 'http://store:8080/', allowHosts: ['store:8080'],
    patches: [patch('f1')], lease: s.deps.lease, emit: s.deps.emit,
  });
});
