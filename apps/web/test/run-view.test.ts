import { describe, expect, test } from 'vitest';
import type { Finding, RunEvent } from '@earshot/shared';
import { emptyView, reduce, type RunView, type StepEvent } from '../src/reduce.js';
import { workState } from '../src/run/work.js';
import { splitPoint } from '../src/run/HowFar.js';
import { afterExcerpt } from '../src/run/Result.js';

const fold = (events: RunEvent[], v: RunView = emptyView()) => events.reduce(reduce, v);
const limits = { memoryBytes: 1 << 30, nanoCpus: 750_000_000, pidsLimit: 256, runtime: 'runsc', timeoutMs: 120_000 };
const created: RunEvent = { t: 'run.created', runId: 'r', mode: 'demo', goal: 'g', target: 'https://store.test/' };
const sb = (agent: string): RunEvent => ({ t: 'sandbox.created', runId: 'r', agent: agent as never, containerId: `c-${agent}`, limits });
const gone = (agent: string): RunEvent => ({ t: 'sandbox.destroyed', runId: 'r', agent: agent as never, containerId: `c-${agent}`, reason: 'finished' });
const step = (agent: string, index: number, milestones: StepEvent['milestones'], extra: Partial<StepEvent> = {}): StepEvent => ({
  t: 'step', runId: 'r', agent: agent as never, index, url: 'u', reasoning: '', action: { type: 'click', target: 'a1' }, result: { ok: true }, milestones, ...extra,
});
const fin = (agent: string, outcome: 'gate' | 'no-progress', milestones: StepEvent['milestones']): RunEvent => ({ t: 'agent.finished', runId: 'r', agent: agent as never, outcome, milestones });
const finding: Finding = {
  id: 'f1', runId: 'r', milestone: 'grind_selected', element: { cssPath: 'x', backendNodeId: 1, snippet: '<div>Whole bean</div>', isFinal: false, isFormSubmit: false },
  categories: ['wrong-role'], axeRules: [], wcag: ['4.1.2'], confirmed: true, status: 'verified',
  evidence: { sightedStep: 2, blindLastStep: 4, blindExcerpt: [{ ref: 'a', role: 'text', name: 'Whole bean', states: [], actionable: false }] },
};

describe('workState', () => {
  test('counts live sandboxes, steps and the last blocked request', () => {
    const v = fold([created, sb('sighted'), sb('blind'), step('sighted', 0, []), step('sighted', 1, []), step('blind', 0, []),
      { t: 'containment.blocked', runId: 'r', agent: 'blind', method: 'GET', host: '169.254.169.254', path: '/', reason: 'private-address' }]);
    const w = workState(v);
    expect(w.live).toBe(2);
    expect(w.sandboxes.map((s) => [s.agent, s.steps])).toEqual([['sighted', 2], ['blind', 1]]);
    expect(w.blocked).toBe(1);
    expect(w.lastBlocked).toEqual({ agent: 'blind', host: '169.254.169.254' });
    expect(w.limits?.pidsLimit).toBe(256);
  });
  test('a deleted sandbox is no longer live and says why it ended', () => {
    const w = workState(fold([created, sb('blind'), gone('blind')]));
    expect(w.live).toBe(0);
    expect(w.sandboxes[0]?.ended).toBe('finished');
  });
});

describe('splitPoint', () => {
  const base = [created, sb('sighted'), sb('blind'), fin('sighted', 'gate', ['on_product_page', 'grind_selected', 'in_cart']), fin('blind', 'no-progress', ['on_product_page'])];
  test('names the first checkpoint the blind agent missed', () => {
    expect(splitPoint(fold(base))).toMatchObject({ label: 'Grind chosen' });
  });
  test('links the confirmed finding for that checkpoint', () => {
    expect(splitPoint(fold([...base, { t: 'finding', finding }]))).toMatchObject({ findingId: 'f1', element: '“Whole bean”' });
  });
  test('no split while the blind agent is still going', () => {
    expect(splitPoint(fold([created, fin('sighted', 'gate', ['on_product_page', 'grind_selected'])]))).toBeNull();
  });
});

describe('afterExcerpt', () => {
  test('the rerun step that passed the checkpoint shows the same element, now usable', () => {
    const radio = { ref: 'b', role: 'radio', name: 'Whole bean', states: ['checked'], actionable: true };
    const v = fold([created, { t: 'finding', finding }, step('rerun-1', 1, ['on_product_page', 'grind_selected'], { axExcerpt: [radio, { ref: 'c', role: 'link', name: 'Home', states: [], actionable: true }] })]);
    expect(afterExcerpt(v, finding)).toEqual([radio]);
  });
  test('null when no rerun got there', () => {
    expect(afterExcerpt(fold([created]), finding)).toBeNull();
  });
});
