import { describe, expect, test } from 'vitest';
import type { RunEvent } from '@earshot/shared';
import { emptyView, isPaused, reduce, type RunView } from '../src/reduce.js';

const fold = (events: RunEvent[], v: RunView = emptyView()) => events.reduce(reduce, v);
const limits = { memoryBytes: 1 << 30, nanoCpus: 750_000_000, pidsLimit: 256, runtime: 'runsc', timeoutMs: 210_000 };
const step = (agent: string, index: number): RunEvent => ({
  t: 'step', runId: 'r', agent: agent as never, index, url: 'u', reasoning: 'why', action: { type: 'click', target: 'a1' }, result: { ok: true }, milestones: ['on_product_page'],
});

describe('Task 15 reducer', () => {
  test('run.created sets meta; reduce never mutates its input', () => {
    const v0 = emptyView();
    const v = reduce(v0, { t: 'run.created', runId: 'r', mode: 'demo', goal: 'g', target: 'http://store:8080/' });
    expect(v.meta).toEqual({ runId: 'r', mode: 'demo', goal: 'g', target: 'http://store:8080/' });
    expect(v0.meta).toBeUndefined();
  });

  test('step events append to the right agent', () => {
    const v = fold([step('sighted', 0), step('blind', 0), step('blind', 1)]);
    expect(v.agents.sighted!.steps).toHaveLength(1);
    expect(v.agents.blind!.steps.map((s) => s.index)).toEqual([0, 1]);
    expect(v.agents.blind!.milestones).toEqual(['on_product_page']);
  });

  test('sandbox.destroyed marks the agent sandbox and both land in the rail', () => {
    const v = fold([
      { t: 'sandbox.created', runId: 'r', agent: 'blind', containerId: 'abc', limits },
      { t: 'sandbox.destroyed', runId: 'r', agent: 'blind', containerId: 'abc', reason: 'finished' },
    ]);
    expect(v.agents.blind!.sandbox).toEqual({ id: 'abc', limits, destroyed: 'finished' });
    expect(v.containment.map((e) => e.t)).toEqual(['sandbox.created', 'sandbox.destroyed']);
  });

  test('containment.blocked lands in the rail', () => {
    const v = fold([{ t: 'containment.blocked', runId: 'r', agent: 'rerun-1', method: 'CONNECT', host: 'cardcheck.attacker.invalid', path: '', reason: 'not-allowlisted' }]);
    expect(v.containment).toHaveLength(1);
    expect(v.containment[0]).toMatchObject({ t: 'containment.blocked', host: 'cardcheck.attacker.invalid' });
  });

  test('rerun-2 creates a third-column entry; inspector does not', () => {
    const v = fold([step('rerun-2', 0), { t: 'sandbox.created', runId: 'r', agent: 'inspector', containerId: 'i', limits }]);
    expect(v.agents['rerun-2']!.steps).toHaveLength(1);
    expect(reruns(v)).toEqual(['rerun-2']);
  });

  test('agent.finished records the outcome; run.queued and run.finished', () => {
    const v = fold([
      { t: 'run.queued', runId: 'r', position: 2 },
      { t: 'agent.finished', runId: 'r', agent: 'sighted', outcome: 'gate', milestones: ['on_product_page', 'grind_selected'] },
      { t: 'run.finished', runId: 'r', verified: true },
    ]);
    expect(v.queuePosition).toBe(2);
    expect(v.agents.sighted).toMatchObject({ outcome: 'gate', milestones: ['on_product_page', 'grind_selected'] });
    expect(v.finished).toEqual({ verified: true });
  });
});

import { reruns } from '../src/reduce.js';

describe('Task 16 reducer', () => {
  const el = { cssPath: 'button', backendNodeId: 1, snippet: '<button data-earshot-final>Place order</button>', isFinal: true, isFormSubmit: true };
  const finding = { id: 'f1', runId: 'r', milestone: 'grind_selected', element: el, categories: ['wrong-role' as const], axeRules: [], wcag: ['4.1.2'], confirmed: true, evidence: { sightedStep: 2, blindLastStep: 3, blindExcerpt: [] }, status: 'open' as const };
  const patch = { findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio' }, keyboardShim: true };

  test('approval.requested sets the pending approval; approval.resolved clears it', () => {
    const v1 = fold([{ t: 'approval.requested', runId: 'r', agent: 'blind', approvalId: 'ap1', element: el }]);
    expect(v1.approval).toMatchObject({ approvalId: 'ap1', agent: 'blind', element: el });
    const v2 = reduce(v1, { t: 'approval.resolved', runId: 'r', approvalId: 'ap1', decision: 'denied' });
    expect(v2.approval).toBeUndefined();
    const v3 = reduce(v1, { t: 'approval.resolved', runId: 'r', approvalId: 'other', decision: 'denied' });
    expect(v3.approval?.approvalId).toBe('ap1');
  });

  test('finding events add or replace findings by id', () => {
    const v = fold([{ t: 'finding', finding }, { t: 'finding', finding: { ...finding, status: 'unverified' } }]);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]!.status).toBe('unverified');
  });

  test('fix.result appends per finding and flips the finding status to verified', () => {
    const v = fold([
      { t: 'finding', finding },
      { t: 'fix.result', runId: 'r', findingId: 'f1', attempt: 1, patch, diff: '-a\n+b', verified: false },
      { t: 'fix.result', runId: 'r', findingId: 'f1', attempt: 2, patch, diff: '-a\n+c', verified: true },
    ]);
    expect(v.fixes.f1!.map((f) => [f.attempt, f.verified])).toEqual([[1, false], [2, true]]);
    expect(v.findings[0]!.status).toBe('verified');
  });
});

describe('phase, pause and stop', () => {
  test('run.phase sets phase and keeps fixDeadlineAt only while awaiting a fix', () => {
    let v = fold([{ t: 'run.phase', runId: 'r', phase: 'running' }]);
    expect(v.phase).toBe('running');
    v = fold([{ t: 'run.phase', runId: 'r', phase: 'awaiting-fix', fixDeadlineAt: 5000 }], v);
    expect(v.fixDeadlineAt).toBe(5000);
    v = fold([{ t: 'run.phase', runId: 'r', phase: 'fixing' }], v);
    expect(v.phase).toBe('fixing');
    expect(v.fixDeadlineAt).toBeUndefined();
  });

  test('run.paused then run.resumed is not paused', () => {
    const v = fold([{ t: 'run.paused', runId: 'r', resumeAt: 10_000 }]);
    expect(isPaused(v, 1000)).toBe(true);
    expect(isPaused(fold([{ t: 'run.resumed', runId: 'r', by: 'user' }], v), 1000)).toBe(false);
  });

  test('a replayed run.paused whose resumeAt has passed is not paused', () => {
    expect(isPaused(fold([{ t: 'run.paused', runId: 'r', resumeAt: 10_000 }]), 20_000)).toBe(false);
  });

  test('run.finished clears pause and marks a stop', () => {
    const v = fold([
      { t: 'run.paused', runId: 'r', resumeAt: 10_000 },
      { t: 'run.finished', runId: 'r', verified: false, error: 'Stopped by the person who started this run' },
    ]);
    expect(v.paused).toBeUndefined();
    expect(v.stopped).toBe(true);
    expect(isPaused(v, 0)).toBe(false);
  });
});

test('run.finished clears a pending approval (e.g. after Stop)', () => {
  const v = fold([
    { t: 'approval.requested', runId: 'r', agent: 'sighted', approvalId: 'a', element: { cssPath: 'b', backendNodeId: 1, snippet: '<button>', isFinal: true, isFormSubmit: true } },
    { t: 'run.finished', runId: 'r', verified: false, error: 'Stopped by the person who started this run' },
  ]);
  expect(v.approval).toBeUndefined();
});
