import { describe, expect, test } from 'vitest';
import { DEMO_MILESTONES, modePolicy, type ActResult, type ElementIdentity, type Journey, type JourneyStep, type MilestoneId, type RunMode } from '../src/index.js';

const el = (cssPath: string, over: Partial<ElementIdentity> = {}): ElementIdentity => ({ cssPath, backendNodeId: 1, snippet: `<${cssPath}>`, isFinal: false, isFormSubmit: false, ...over });
const step = (index: number, cssPath: string | null, milestonesAfter: MilestoneId[], ok = true): JourneyStep => ({
  index, result: { ok, ...(cssPath ? { element: el(cssPath) } : {}) } as ActResult, milestonesAfter,
});

const sighted: Journey = {
  outcome: 'gate',
  milestones: [...DEMO_MILESTONES],
  steps: [
    step(0, 'a.product', ['on_product_page']),
    step(1, null, ['on_product_page']),
    step(2, '.grind-swatch.whole', ['on_product_page', 'grind_selected']),
    step(3, '.icon-btn', ['on_product_page', 'grind_selected', 'in_cart']),
  ],
};
const blind: Journey = { outcome: 'no-progress', milestones: ['on_product_page'], steps: [step(0, 'a.product', ['on_product_page']), step(1, '.icon-btn', ['on_product_page'], false)] };

describe('checkpoints', () => {
  test.each<[RunMode | undefined, string[]]>([
    ['demo', ['Product page', 'Grind chosen', 'In cart', 'Checkout', 'Details entered', 'Review', 'Place order']],
    ['drill', ['Product page', 'Grind chosen', 'In cart', 'Checkout', 'Details entered', 'Review', 'Place order']],
    [undefined, ['Product page', 'Grind chosen', 'In cart', 'Checkout', 'Details entered', 'Review', 'Place order']],
    ['any-url', ['Start', 'Submit']],
  ])('%s', (mode, labels) => {
    expect(modePolicy(mode).checkpoints.map((c) => c.label)).toEqual(labels);
  });

  test('label names a checkpoint in the words of its mode', () => {
    expect(modePolicy('demo').label('awaiting_final_approval')).toBe('Place order');
    expect(modePolicy('any-url').label('awaiting_final_approval')).toBe('Submit');
    expect(modePolicy('any-url').label('on_product_page')).toBe('Start');
  });
});

describe('reached', () => {
  test.each<[RunMode, Parameters<ReturnType<typeof modePolicy>['reached']>[0], number]>([
    ['demo', { milestones: [], steps: 0 }, 0],
    ['demo', { milestones: ['on_product_page', 'grind_selected'], steps: 4 }, 2],
    ['any-url', { milestones: [], steps: 0 }, 0],
    ['any-url', { milestones: [], steps: 1 }, 1],
    ['any-url', { milestones: [], steps: 3, outcome: 'gate' }, 2],
    ['any-url', { milestones: ['awaiting_final_approval'], steps: 3 }, 2],
  ])('%s %j → %i', (mode, progress, n) => {
    expect(modePolicy(mode).reached(progress)).toBe(n);
  });
});

describe('gate, success and fixability', () => {
  test.each<[RunMode, boolean, boolean, boolean, boolean]>([
    // mode,      final, form submit, done counts, fixable
    ['demo',     true, false, false, true],
    ['drill',    true, false, false, true],
    ['any-url',  true, true,  true,  false],
  ])('%s', (mode, final, submit, doneCounts, fixable) => {
    const p = modePolicy(mode);
    expect(p.gatesOn(el('b', { isFinal: true }))).toBe(final);
    expect(p.gatesOn(el('b', { isFormSubmit: true }))).toBe(submit);
    expect(p.gatesOn(el('b'))).toBe(false);
    expect(p.succeeded('gate')).toBe(true);
    expect(p.succeeded('done')).toBe(doneCounts);
    expect(p.succeeded('no-progress')).toBe(false);
    expect(p.fixable).toBe(fixable);
  });
});

describe('divergence', () => {
  test('demo: blind stalled at the product page → grind_selected with the sighted index', () => {
    expect(modePolicy('demo').divergence(sighted, blind)).toEqual({ checkpoint: 'grind_selected', sightedStepIndex: 2 });
  });

  test('demo: no divergence when blind got as far', () => {
    expect(modePolicy('demo').divergence(sighted, { ...sighted })).toBeNull();
  });

  test('demo: never blames the final purchase button for an earlier checkpoint', () => {
    const finalStep = step(5, 'button.final', [...DEMO_MILESTONES]);
    finalStep.result.element!.isFinal = true;
    const s: Journey = { outcome: 'gate', milestones: [...DEMO_MILESTONES], steps: [step(4, 'span.btn-primary', DEMO_MILESTONES.slice(0, 5)), finalStep] };
    const b: Journey = { outcome: 'no-progress', milestones: DEMO_MILESTONES.slice(0, 5), steps: [] };
    expect(modePolicy('demo').divergence(s, b)).toEqual({ checkpoint: 'on_review', sightedStepIndex: 4 });
  });

  test('any-url: the first sighted element blind never touched blocks Submit', () => {
    const b: Journey = { outcome: 'max-steps', milestones: [], steps: [step(0, 'a.product', [])] };
    expect(modePolicy('any-url').divergence(sighted, b)).toEqual({ checkpoint: 'awaiting_final_approval', sightedStepIndex: 2 });
  });

  test('any-url: no divergence when blind succeeded', () => {
    const b: Journey = { outcome: 'max-steps', milestones: [], steps: [step(0, 'a.product', [])] };
    expect(modePolicy('any-url').divergence(sighted, { ...b, outcome: 'gate' })).toBeNull();
    expect(modePolicy('any-url').divergence(sighted, { ...b, outcome: 'done' })).toBeNull();
  });
});
