import { expect, test, vi } from 'vitest';
import { leaseWith } from '../src/sandbox/lease.js';
import type { ActResult, AxNodeView, ElementIdentity, ElementReport, MilestoneId, RpcCall, RunEvent } from '@earshot/shared';
import { attribute, findDivergence } from '../src/attribution/attribute.js';
import type { AgentResult, RecordedStep } from '../src/agents/loop.js';
import type { Sandbox, SandboxOpts } from '../src/sandbox/docker.js';

const el = (cssPath: string): ElementIdentity => ({ cssPath, backendNodeId: 1, snippet: `<${cssPath}>`, isFinal: false, isFormSubmit: false });
const step = (index: number, cssPath: string | null, milestonesAfter: MilestoneId[], ok = true): RecordedStep => ({
  index, action: cssPath ? { type: 'click', target: String(index) } : { type: 'scroll', direction: 'down' },
  result: { ok, ...(cssPath ? { element: el(cssPath) } : {}) } as ActResult, milestonesAfter, reasoning: '', url: 'u',
});

const sighted: AgentResult = {
  outcome: 'gate',
  milestones: ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered', 'on_review', 'awaiting_final_approval'],
  steps: [
    step(0, 'a.product', ['on_product_page']),
    step(1, null, ['on_product_page']),
    step(2, '.grind-swatch.whole', ['on_product_page', 'grind_selected']),
    step(3, '.icon-btn', ['on_product_page', 'grind_selected', 'in_cart']),
  ],
};
const blind: AgentResult = { outcome: 'no-progress', milestones: ['on_product_page'], steps: [step(0, 'a.product', ['on_product_page']), step(1, '.icon-btn', ['on_product_page'], false)] };

test('findDivergence: blind stalled at on_product_page → grind_selected with the sighted index', () => {
  expect(findDivergence(sighted, blind, 'demo')).toEqual({ milestone: 'grind_selected', sightedStepIndex: 2 });
});

test('findDivergence: no divergence when blind got as far', () => {
  expect(findDivergence(sighted, { ...sighted }, 'demo')).toBeNull();
});

test('findDivergence any-url: first sighted element blind never touched', () => {
  const b: AgentResult = { outcome: 'max-steps', milestones: [], steps: [step(0, 'a.product', [])] };
  expect(findDivergence(sighted, b, 'any-url')).toEqual({ milestone: '.grind-swatch.whole', sightedStepIndex: 2 });
  expect(findDivergence(sighted, { ...b, outcome: 'gate' }, 'any-url')).toBeNull();
});

const swatchReport: ElementReport = { identity: el('.grind-swatch.whole'), inAxTree: true, axRole: 'generic', axName: '', focusable: false, tabReachable: false, keyActivates: null, hasProgrammaticLabel: null, axeViolations: [] };
const okReport: ElementReport = { ...swatchReport, axRole: 'button', axName: 'Fine', focusable: true, tabReachable: true, keyActivates: true };

function fakeFactory(handler: (req: RpcCall) => unknown) {
  const created: SandboxOpts[] = [];
  const calls: RpcCall[] = [];
  const destroyed: string[] = [];
  const createSandbox = vi.fn(async (opts: SandboxOpts) => {
    created.push(opts);
    return {
      id: 'insp', ip: '', agent: opts.agent, destroyed: false, limits: {} as never,
      rpc: { call: async (req: RpcCall) => { calls.push(req); return handler(req); } },
      destroy: async (r: string) => { destroyed.push(r); },
    } as unknown as Sandbox;
  });
  return { createSandbox, created, calls, destroyed };
}

const speech: AxNodeView[] = [{ ref: 'a1', role: 'StaticText', name: 'Whole bean', states: [], actionable: false }];

test('attribute replays up to the divergence, inspects, emits a confirmed finding and destroys the inspector', async () => {
  const f = fakeFactory((req) => (req.m === 'inspect' ? swatchReport : req.m === 'axSpeech' ? speech : req.m === 'replay' ? { replayed: 2 } : {}));
  const events: RunEvent[] = [];
  const finding = await attribute({ runId: 'r1', mode: 'demo', sighted, blind, startUrl: 'http://store:8080/', allowHosts: ['store:8080'], patches: [], lease: leaseWith(f.createSandbox), emit: (e) => events.push(e) });
  expect(f.created[0]).toMatchObject({ agent: 'inspector', mode: 'demo', allowHosts: ['store:8080'] });
  const replay = f.calls.find((c) => c.m === 'replay') as Extract<RpcCall, { m: 'replay' }>;
  expect(replay.actions.map((a) => a.cssPath)).toEqual(['a.product', '']);
  expect(f.calls.map((c) => c.m)).toEqual(['open', 'replay', 'axSpeech', 'inspect']);
  expect(finding).toMatchObject({ milestone: 'grind_selected', confirmed: true, categories: ['wrong-role', 'not-keyboard-operable'], status: 'open', evidence: { sightedStep: 2, blindLastStep: 1, blindExcerpt: speech } });
  expect(events).toEqual([{ t: 'finding', finding }]);
  expect(f.destroyed).toEqual(['finished']);
});

test('attribute is unconfirmed (inconclusive) when classify finds nothing', async () => {
  const f = fakeFactory((req) => (req.m === 'inspect' ? okReport : req.m === 'axSpeech' ? [] : {}));
  const finding = await attribute({ runId: 'r1', mode: 'demo', sighted, blind, startUrl: 'u', allowHosts: [], patches: [], lease: leaseWith(f.createSandbox), emit: () => {} });
  expect(finding!.confirmed).toBe(false);
});

test('the inspector is always destroyed even if inspect throws', async () => {
  const f = fakeFactory((req) => { if (req.m === 'inspect') throw new Error('boom'); return []; });
  await expect(attribute({ runId: 'r1', mode: 'demo', sighted, blind, startUrl: 'u', allowHosts: [], patches: [], lease: leaseWith(f.createSandbox), emit: () => {} })).rejects.toThrow('boom');
  expect(f.destroyed).toEqual(['error']);
});

test('no divergence → no inspector, null', async () => {
  const f = fakeFactory(() => ({}));
  expect(await attribute({ runId: 'r1', mode: 'demo', sighted, blind: sighted, startUrl: 'u', allowHosts: [], patches: [], lease: leaseWith(f.createSandbox), emit: () => {} })).toBeNull();
  expect(f.createSandbox).not.toHaveBeenCalled();
});

test('findDivergence never blames the final purchase button for an earlier milestone', () => {
  const finalStep = { ...step(5, 'button.final', ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered', 'on_review', 'awaiting_final_approval']), };
  (finalStep.result.element as any).isFinal = true;
  const s: AgentResult = {
    outcome: 'gate', milestones: finalStep.milestonesAfter,
    steps: [step(4, 'span.btn-primary', ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered']), finalStep],
  };
  const b: AgentResult = { outcome: 'no-progress', milestones: ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered'], steps: [] };
  expect(findDivergence(s, b, 'demo')).toEqual({ milestone: 'on_review', sightedStepIndex: 4 });
});
