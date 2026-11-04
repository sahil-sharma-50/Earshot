import { describe, expect, test } from 'vitest';
import type { Finding, RunEvent } from '@earshot/shared';
import { emptyView, reduce, type RunView, type StepEvent } from '../src/reduce.js';
import { controlsFor } from '../src/run/controls.js';
import { journeyRows } from '../src/run/journey.js';
import { latestStep, nextSelection, stepAtCheckpoint, type Selection } from '../src/run/selection.js';

const fold = (events: RunEvent[], v: RunView = emptyView()) => events.reduce(reduce, v);
const limits = { memoryBytes: 1 << 30, nanoCpus: 750_000_000, pidsLimit: 256, runtime: 'runsc', timeoutMs: 210_000 };
const created = (mode: 'demo' | 'any-url' = 'demo'): RunEvent => ({ t: 'run.created', runId: 'r', mode, goal: 'g', target: 't' });
const sb = (agent: string): RunEvent => ({ t: 'sandbox.created', runId: 'r', agent: agent as never, containerId: `c-${agent}`, limits });
const phase = (p: 'running' | 'awaiting-fix' | 'fixing'): RunEvent => ({ t: 'run.phase', runId: 'r', phase: p });
const step = (agent: string, index: number, milestones: StepEvent['milestones']): StepEvent => ({
  t: 'step', runId: 'r', agent: agent as never, index, url: 'u', reasoning: '', action: { type: 'click', target: 'a1' }, result: { ok: true }, milestones,
});
const fin = (agent: string, outcome: 'gate' | 'no-progress', milestones: StepEvent['milestones']): RunEvent => ({ t: 'agent.finished', runId: 'r', agent: agent as never, outcome, milestones });
const finding: Finding = {
  id: 'f1', runId: 'r', milestone: 'grind_selected', element: { cssPath: 'x', backendNodeId: 1, snippet: '<div>Whole bean</div>', isFinal: false, isFormSubmit: false },
  categories: ['wrong-role'], axeRules: [], wcag: ['4.1.2'], confirmed: true, evidence: { sightedStep: 2, blindLastStep: 4, blindExcerpt: [] }, status: 'open',
};

describe('controlsFor', () => {
  const running = fold([created(), phase('running'), sb('blind')]);
  test('starter while agents run can pause and stop', () => {
    expect(controlsFor(running, true, 0)).toEqual({ pause: true, resume: false, stop: true });
  });
  test('paused offers resume and stop', () => {
    expect(controlsFor(fold([{ t: 'run.paused', runId: 'r', resumeAt: 30_000 }], running), true, 0)).toEqual({ pause: false, resume: true, stop: true });
  });
  test('awaiting a fix can only stop', () => {
    expect(controlsFor(fold([created(), phase('awaiting-fix')]), true, 0)).toEqual({ pause: false, resume: false, stop: true });
  });
  test('finished offers nothing', () => {
    expect(controlsFor(fold([{ t: 'run.finished', runId: 'r', verified: true }], running), true, 0)).toEqual({ pause: false, resume: false, stop: false });
  });
  test('a viewer who did not start the run gets no controls and an explanation', () => {
    expect(controlsFor(running, false, 0)).toEqual({ pause: false, resume: false, stop: false, note: 'Watching. Only the person who started this run can control it.' });
  });
});

describe('journeyRows', () => {
  test('blind stalled at the grind picker with a confirmed finding', () => {
    const v = fold([
      created(), step('sighted', 0, ['on_product_page', 'grind_selected', 'in_cart']), fin('sighted', 'gate', ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered', 'on_review', 'awaiting_final_approval']),
      step('blind', 0, ['on_product_page']), fin('blind', 'no-progress', ['on_product_page']), { t: 'finding', finding },
    ]);
    const [s, b] = journeyRows(v);
    expect(s).toEqual({ agent: 'sighted', reached: 7 });
    expect(b).toEqual({ agent: 'blind', reached: 1, endedAt: { index: 1, outcome: 'no-progress' }, blockedBy: 'f1' });
  });
  test('rerun rows follow sighted and blind in order', () => {
    const v = fold([created(), step('rerun-2', 0, []), step('rerun-1', 0, [])]);
    expect(journeyRows(v).map((r) => r.agent)).toEqual(['sighted', 'blind', 'rerun-1', 'rerun-2']);
  });
  test('any-url counts Start once the agent has stepped', () => {
    const v = fold([created('any-url'), step('blind', 0, [])]);
    expect(journeyRows(v)[1]).toEqual({ agent: 'blind', reached: 1 });
  });
});

describe('selection', () => {
  const v = fold([created(), step('blind', 0, ['on_product_page']), step('blind', 1, ['on_product_page']), step('sighted', 0, ['on_product_page', 'grind_selected'])]);
  test('latestStep is the most recent step event', () => {
    expect(latestStep(v)).toEqual({ agent: 'sighted', index: 0 });
  });
  test('stepAtCheckpoint finds the first step that reached it, else the last step', () => {
    expect(stepAtCheckpoint(v, 'sighted', 'grind_selected')).toBe(0);
    expect(stepAtCheckpoint(v, 'blind', 'grind_selected')).toBe(1);
    expect(stepAtCheckpoint(v, 'rerun-1', 'grind_selected')).toBeNull();
  });
  test('follow-live selects the newest step; otherwise the selection stays', () => {
    const prev: Selection = { kind: 'finding', id: 'f1' };
    expect(nextSelection(prev, v, true)).toEqual({ kind: 'step', agent: 'sighted', index: 0 });
    expect(nextSelection(prev, v, false)).toBe(prev);
    expect(nextSelection(prev, emptyView(), true)).toBe(prev);
  });
});

describe('describeEvent', () => {
  test('a blocked metadata request is an alert that names the address and the reason', async () => {
    const { describeEvent } = await import('../src/run/events.js');
    const d = describeEvent({ t: 'containment.blocked', runId: 'r', agent: 'blind', method: 'GET', host: '169.254.169.254', path: '/latest', reason: 'private-address' });
    expect(d.tone).toBe('alert');
    expect(d.title).toBe('Blocked: GET to 169.254.169.254 (cloud metadata address)');
    expect(d.explain).toContain('private or cloud-metadata address');
  });
  test('a stopped sandbox says why it was destroyed', async () => {
    const { describeEvent } = await import('../src/run/events.js');
    expect(describeEvent({ t: 'sandbox.destroyed', runId: 'r', agent: 'sighted', containerId: 'abcdef1234567890', reason: 'stopped' }).explain).toBe('Destroyed because the run was stopped.');
  });
  test('an unknown block reason falls back to the raw reason', async () => {
    const { describeEvent } = await import('../src/run/events.js');
    expect(describeEvent({ t: 'containment.blocked', runId: 'r', agent: 'blind', method: 'POST', host: 'evil.example', path: '/', reason: 'weird' }).explain).toContain('because weird');
  });
});
