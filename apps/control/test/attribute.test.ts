import { expect, test } from 'vitest';
import { leaseWith } from '../src/sandbox/lease.js';
import type { ActResult, AxNodeView, ElementIdentity, ElementReport, MilestoneId, RpcCall, RunEvent } from '@earshot/shared';
import { attribute } from '../src/attribution/attribute.js';
import type { AgentResult, RecordedStep } from '../src/agents/loop.js';
import { fakeSandboxes } from './fakes.js';

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

const swatchReport: ElementReport = { identity: el('.grind-swatch.whole'), inAxTree: true, axRole: 'generic', axName: '', focusable: false, tabReachable: false, keyActivates: null, hasProgrammaticLabel: null, axeViolations: [] };
const okReport: ElementReport = { ...swatchReport, axRole: 'button', axName: 'Fine', focusable: true, tabReachable: true, keyActivates: true };

const speech: AxNodeView[] = [{ ref: 'a1', role: 'StaticText', name: 'Whole bean', states: [], actionable: false }];

test('attribute replays up to the divergence, inspects, emits a confirmed finding and destroys the inspector', async () => {
  const f = fakeSandboxes({ inspect: () => swatchReport, axSpeech: () => speech, replay: () => ({ replayed: 2 }) });
  const events: RunEvent[] = [];
  const finding = await attribute({ runId: 'r1', mode: 'demo', sighted, blind, startUrl: 'http://store:8080/', allowHosts: ['store:8080'], patches: [], lease: leaseWith(f.createSandbox), emit: (e) => events.push(e) });
  expect(f.created[0]).toMatchObject({ agent: 'inspector', mode: 'demo', allowHosts: ['store:8080'] });
  const replay = f.calls().find((c) => c.m === 'replay') as Extract<RpcCall, { m: 'replay' }>;
  expect(replay.actions.map((a) => a.cssPath)).toEqual(['a.product', '']);
  expect(f.calls().map((c) => c.m)).toEqual(['open', 'replay', 'axSpeech', 'inspect']);
  expect(finding).toMatchObject({ milestone: 'grind_selected', confirmed: true, categories: ['wrong-role', 'not-keyboard-operable'], status: 'open', evidence: { sightedStep: 2, blindLastStep: 1, blindExcerpt: speech } });
  expect(events).toEqual([{ t: 'finding', finding }]);
  expect(f.destroyed).toEqual(['c0:finished']);
});

test('attribute is unconfirmed (inconclusive) when classify finds nothing', async () => {
  const f = fakeSandboxes({ inspect: () => okReport, axSpeech: () => [], replay: () => ({ replayed: 0 }) });
  const finding = await attribute({ runId: 'r1', mode: 'demo', sighted, blind, startUrl: 'u', allowHosts: [], patches: [], lease: leaseWith(f.createSandbox), emit: () => {} });
  expect(finding!.confirmed).toBe(false);
});

test('the inspector is always destroyed even if inspect throws', async () => {
  const f = fakeSandboxes({ inspect: () => { throw new Error('boom'); }, axSpeech: () => [], replay: () => ({ replayed: 0 }) });
  await expect(attribute({ runId: 'r1', mode: 'demo', sighted, blind, startUrl: 'u', allowHosts: [], patches: [], lease: leaseWith(f.createSandbox), emit: () => {} })).rejects.toThrow('boom');
  expect(f.destroyed).toEqual(['c0:error']);
});

test('no divergence → no inspector, null', async () => {
  const f = fakeSandboxes();
  expect(await attribute({ runId: 'r1', mode: 'demo', sighted, blind: sighted, startUrl: 'u', allowHosts: [], patches: [], lease: leaseWith(f.createSandbox), emit: () => {} })).toBeNull();
  expect(f.createSandbox).not.toHaveBeenCalled();
});
