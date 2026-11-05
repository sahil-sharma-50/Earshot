import { describe, expect, test } from 'vitest';
import type { Finding, RunEvent } from '@earshot/shared';
import { emptyView, reduce, type RunView, type StepEvent } from '../src/reduce.js';
import {
  agentState, CATEGORY_EXPLAIN, findingTitle, GLOSSARY, nextCheckpoint, nowLine, phaseSteps, plainAction, plainResult,
} from '../src/narrative.js';

const fold = (events: RunEvent[], v: RunView = emptyView()) => events.reduce(reduce, v);
const limits = { memoryBytes: 1 << 30, nanoCpus: 750_000_000, pidsLimit: 256, runtime: 'runsc', timeoutMs: 210_000 };
const created = (mode: 'demo' | 'any-url' = 'demo'): RunEvent => ({ t: 'run.created', runId: 'r', mode, goal: 'Buy coffee', target: 'http://store:8080/' });
const sb = (agent: string): RunEvent => ({ t: 'sandbox.created', runId: 'r', agent: agent as never, containerId: `c-${agent}`, limits });
const step = (over: Partial<StepEvent> = {}): StepEvent => ({
  t: 'step', runId: 'r', agent: 'blind', index: 0, url: 'u', reasoning: 'why', action: { type: 'click', target: 'a1' }, result: { ok: true }, milestones: ['on_product_page'], ...over,
});
const el = (snippet: string) => ({ cssPath: 'x', backendNodeId: 1, snippet, isFinal: false, isFormSubmit: false });
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', runId: 'r', milestone: 'grind_selected', element: el('<div class="grind-swatch">Whole bean</div>'), categories: ['wrong-role', 'not-keyboard-operable'],
  axeRules: [], wcag: ['4.1.2', '2.1.1'], confirmed: true, evidence: { sightedStep: 2, blindLastStep: 4, blindExcerpt: [] }, status: 'open', ...over,
});

describe('plainAction', () => {
  test('click with a recorded element uses its visible text', () => {
    expect(plainAction(step({ result: { ok: true, element: el('<div>Whole bean</div>') } }))).toBe('Clicked “Whole bean”');
  });
  test('click on an element with no text names its tag', () => {
    expect(plainAction(step({ result: { ok: true, element: el('<button class="icon"><svg></svg></button>') } }))).toBe('Clicked an unlabeled button');
  });
  test('a snippet truncated inside a tag is not shown as text', () => {
    expect(plainAction(step({ result: { ok: true, element: el('<button class="icon-btn" type="submit"><svg aria-hidden="true"><path fill="currentColor" d="M7 18a2 2 0 1 0 0 4') } }))).toBe('Clicked an unlabeled button');
  });
  test('click without an element falls back to the agent target', () => {
    expect(plainAction(step({ agent: 'sighted', action: { type: 'click', target: '9' } }))).toBe('Clicked marked element 9');
    expect(plainAction(step({ action: { type: 'click', target: 'a19' } }))).toBe('Clicked tree item a19');
  });
  test('Tab press names the newly focused element', () => {
    expect(plainAction(step({ action: { type: 'press', key: 'Tab' }, result: { ok: true, element: el('<a href="/cart">Cart (0)</a>') } }))).toBe('Pressed Tab (focus moved to “Cart (0)”)');
    expect(plainAction(step({ action: { type: 'press', key: 'Tab' } }))).toBe('Pressed Tab');
  });
  test('type, scroll, done and stuck read as sentences', () => {
    expect(plainAction(step({ action: { type: 'type', target: 'a3', text: 'Ada' }, result: { ok: true, element: el('<input name="name">') } }))).toBe('Typed “Ada” into an unlabeled input');
    expect(plainAction(step({ action: { type: 'scroll', direction: 'down' } }))).toBe('Scrolled down');
    expect(plainAction(step({ action: { type: 'done', reason: 'ok' } }))).toBe('Said the goal is done');
    expect(plainAction(step({ action: { type: 'stuck', reason: 'no grind control' } }))).toBe('Gave up: no grind control');
  });
});

describe('plainResult', () => {
  test('known error codes read in plain words', () => {
    expect(plainResult(step({ result: { ok: false, error: 'not-actionable' } }))).toEqual({ ok: false, text: 'That element can’t be operated' });
    expect(plainResult(step({ result: { ok: false, error: 'approval-denied' } }))).toEqual({ ok: false, text: 'Purchase not approved' });
  });
  test('an unknown error code falls back to the raw code, never blank', () => {
    expect(plainResult(step({ result: { ok: false, error: 'weird-thing' } }))).toEqual({ ok: false, text: 'weird-thing' });
    expect(plainResult(step({ result: { ok: false } })).text).not.toBe('');
  });
  test('success', () => {
    expect(plainResult(step())).toEqual({ ok: true, text: 'Done' });
  });
});

describe('checkpoints', () => {
  test('nextCheckpoint is the first unreached one', () => {
    const v = fold([created(), step()]);
    expect(nextCheckpoint(v, 'blind')).toBe('Grind chosen');
    expect(nextCheckpoint(fold([created('any-url'), step({ milestones: [] })]), 'blind')).toBe('Submit');
  });
});

describe('agentState', () => {
  test('no sandbox yet', () => {
    expect(agentState(fold([created()]), 'blind', 0)).toMatchObject({ label: 'Starting', tone: 'idle' });
  });
  test('running names the step and the next checkpoint', () => {
    const s = agentState(fold([created(), sb('blind'), step()]), 'blind', 0);
    expect(s).toMatchObject({ label: 'Running · step 2', tone: 'live' });
    expect(s.reason).toBe('Heading for Grind chosen');
  });
  test('stalled outcome explains why', () => {
    const v = fold([created(), sb('blind'), step(), { t: 'agent.finished', runId: 'r', agent: 'blind', outcome: 'no-progress', milestones: ['on_product_page'] }]);
    expect(agentState(v, 'blind', 0)).toMatchObject({ label: 'Stalled', tone: 'failed', reason: 'Three actions in a row changed nothing on the page' });
  });
  test('waiting for approval', () => {
    const v = fold([created(), sb('sighted'), { t: 'approval.requested', runId: 'r', agent: 'sighted', approvalId: 'a', element: el('<button>Place order</button>') }]);
    expect(agentState(v, 'sighted', 0)).toMatchObject({ tone: 'waiting', label: 'Waiting for approval' });
  });
  test('paused', () => {
    const v = fold([created(), sb('blind'), step(), { t: 'run.paused', runId: 'r', resumeAt: 30_000 }]);
    expect(agentState(v, 'blind', 1000)).toMatchObject({ tone: 'waiting', label: 'Paused' });
  });
});

describe('phaseSteps', () => {
  const states = (v: RunView) => phaseSteps(v).map((p) => `${p.key}:${p.state}`);
  test('queued', () => {
    expect(states(fold([created(), { t: 'run.phase', runId: 'r', phase: 'queued' }]))[0]).toBe('queue:current');
  });
  test('agents running', () => {
    expect(states(fold([created(), { t: 'run.phase', runId: 'r', phase: 'running' }, sb('blind')]))).toEqual(['queue:done', 'agents:current', 'compare:upcoming', 'fix:upcoming', 'verify:upcoming']);
  });
  test('inspector sandbox means compare is current', () => {
    expect(states(fold([created(), { t: 'run.phase', runId: 'r', phase: 'running' }, sb('inspector')]))[2]).toBe('compare:current');
  });
  test('awaiting fix', () => {
    expect(states(fold([created(), { t: 'run.phase', runId: 'r', phase: 'awaiting-fix', fixDeadlineAt: 1 }]))[3]).toBe('fix:current');
  });
  test('finished without a confirmed finding skips fix and verify as not needed', () => {
    const p = phaseSteps(fold([created(), { t: 'run.phase', runId: 'r', phase: 'finished' }, { t: 'run.finished', runId: 'r', outcome: 'verified', verified: true }]));
    expect(p.slice(3).map((x) => [x.state, x.note])).toEqual([['skipped', 'Not needed'], ['skipped', 'Not needed']]);
  });
  test('a stopped run marks the phase it was in as stopped and later phases as skipped', () => {
    const p = phaseSteps(fold([created(), { t: 'run.phase', runId: 'r', phase: 'running' }, sb('blind'),
      { t: 'run.finished', runId: 'r', outcome: 'stopped', verified: false, error: 'Stopped by the person who started this run' }]));
    expect(p.map((x) => x.state)).toEqual(['done', 'stopped', 'skipped', 'skipped', 'skipped']);
    expect(p[1]!.note).toBe('Stopped here');
  });
  test('any-url skips fix and verify as findings only', () => {
    const p = phaseSteps(fold([created('any-url'), { t: 'run.finished', runId: 'r', outcome: 'unverified', verified: false }]));
    expect(p[3]).toMatchObject({ state: 'skipped', note: 'Findings only' });
  });
});

describe('nowLine', () => {
  test('queue position', () => {
    expect(nowLine(fold([created(), { t: 'run.queued', runId: 'r', position: 2 }]), true, 0)).toMatchObject({ text: 'Waiting for a free sandbox slot (position 2).', next: 'Your run starts automatically.' });
  });
  test('latest step with next checkpoint', () => {
    const v = fold([created(), sb('blind'), step({ index: 4, action: { type: 'press', key: 'Tab' } })]);
    expect(nowLine(v, true, 0)).toMatchObject({ text: 'Blind agent, step 5: Pressed Tab.', next: 'Next checkpoint: Grind chosen.' });
  });
  test('approval needs the starter; others are told who decides', () => {
    const v = fold([created(), sb('sighted'), { t: 'approval.requested', runId: 'r', agent: 'sighted', approvalId: 'a', element: el('<button>Place order</button>') }]);
    expect(nowLine(v, true, 0)).toMatchObject({ needsYou: 'approval', text: 'Needs you: the sighted agent wants to place the order.' });
    const other = nowLine(v, false, 0);
    expect(other.needsYou).toBeUndefined();
    expect(other.text).toBe('The sighted agent is waiting for the person who started this run to approve the order.');
  });
  test('fix needs the starter and shows the deadline', () => {
    const v = fold([created(), { t: 'finding', finding: finding() }, { t: 'run.phase', runId: 'r', phase: 'awaiting-fix', fixDeadlineAt: 125_000 }]);
    expect(nowLine(v, true, 5_000)).toMatchObject({ needsYou: 'fix', text: 'Needs you: 1 confirmed finding. Start Fix & verify to patch it and rerun the blind agent.', next: 'Available for 2:00.' });
    expect(nowLine(v, false, 5_000).text).toBe('Waiting for the person who started this run to start Fix & verify.');
  });
  test('both agents finished before the inspector starts: says it is comparing, not the last step', () => {
    const v = fold([created(), sb('sighted'), sb('blind'), step({ agent: 'sighted' }), step(),
      { t: 'agent.finished', runId: 'r', agent: 'sighted', outcome: 'gate', milestones: ['on_product_page'] },
      { t: 'agent.finished', runId: 'r', agent: 'blind', outcome: 'no-progress', milestones: ['on_product_page'] }]);
    expect(nowLine(v, true, 0).text).toBe('Both agents finished. Comparing their journeys to find where they diverged.');
  });
  test('paused shows seconds left', () => {
    const v = fold([created(), sb('blind'), step(), { t: 'run.paused', runId: 'r', resumeAt: 30_000 }]);
    expect(nowLine(v, true, 6_000)).toMatchObject({ text: 'Paused. Resumes automatically in 24 s.', next: 'Sandbox time caps keep running.' });
  });
  test('stopped and verified endings', () => {
    const stopped = fold([created(), sb('sighted'), sb('blind'), { t: 'run.finished', runId: 'r', outcome: 'stopped', verified: false, error: 'Stopped by the person who started this run' }]);
    expect(nowLine(stopped, true, 0)).toEqual({ stopped: true, text: 'You stopped this run.', next: 'Both agents were halted and all 2 sandboxes were destroyed. Nothing else will happen on this run.' });
    expect(nowLine(stopped, false, 0).text).toBe('The person who started this run stopped it.');
    expect(nowLine(fold([created(), { t: 'run.finished', runId: 'r', outcome: 'verified', verified: true }]), true, 0).text).toBe('Journey verified end to end.');
  });
  test('any-url with no milestones never says undefined', () => {
    const v = fold([created('any-url'), sb('blind'), step({ milestones: [] })]);
    expect(JSON.stringify(nowLine(v, true, 0))).not.toContain('undefined');
  });
});

describe('findings copy', () => {
  test('every category has wrong, impact and fix text', () => {
    for (const c of ['not-exposed', 'no-name', 'wrong-role', 'not-keyboard-operable', 'unlabeled-field'] as const) {
      expect(CATEGORY_EXPLAIN[c].wrong && CATEGORY_EXPLAIN[c].impact && CATEGORY_EXPLAIN[c].fix).toBeTruthy();
    }
  });
  test('finding title names the element and the checkpoint', () => {
    expect(findingTitle(finding())).toBe('“Whole bean” can’t be used without sight · blocks Grind chosen');
    expect(findingTitle(finding({ confirmed: false }))).toBe('Not confirmed: “Whole bean” · Grind chosen');
  });
  test('an any-url finding blocks Submit, named in that mode’s words', () => {
    expect(findingTitle(finding({ milestone: 'awaiting_final_approval' }), 'any-url')).toBe('“Whole bean” can’t be used without sight · blocks Submit');
    expect(findingTitle(finding({ milestone: 'awaiting_final_approval' }), 'demo')).toBe('“Whole bean” can’t be used without sight · blocks Place order');
  });
  test('glossary covers phases and outcomes', () => {
    for (const k of ['queue', 'agents', 'compare', 'fix', 'verify', 'no-progress', 'gate', 'stopped', 'sandbox', 'egress proxy', 'accessibility tree', 'checkpoint']) {
      expect(GLOSSARY[k], k).toBeTruthy();
    }
  });
});
