import { expect, test } from 'vitest';
import type { AgentId, RunEvent } from '@earshot/shared';
import { emptyView, reduce, stageOf, type RunView } from '../src/reduce.js';
import { nowLine, phaseSteps } from '../src/narrative.js';

const R = 'r';
const sb = (agent: AgentId): RunEvent => ({ t: 'sandbox.created', runId: R, agent, containerId: `c-${agent}`, limits: {} as never });
const gone = (agent: AgentId, reason: 'finished' | 'stopped' = 'finished'): RunEvent => ({ t: 'sandbox.destroyed', runId: R, agent, containerId: `c-${agent}`, reason });
const step = (agent: AgentId, index = 0): RunEvent => ({ t: 'step', runId: R, agent, index, url: 'u', reasoning: '', action: { type: 'press', key: 'Tab' }, result: { ok: true }, milestones: [] });
const done = (agent: AgentId, outcome: 'gate' | 'no-progress'): RunEvent => ({ t: 'agent.finished', runId: R, agent, outcome, milestones: [] });
const phase = (p: Extract<RunEvent, { t: 'run.phase' }>['phase']): RunEvent => ({ t: 'run.phase', runId: R, phase: p });

/** The event order a real demo run with one fix produced (local e2e, real sandboxes). */
const script: [RunEvent[], ReturnType<typeof stageOf>, number][] = [
  [[{ t: 'run.created', runId: R, mode: 'demo', goal: 'g', target: 't' }, phase('queued')], 'queued', 0],
  [[phase('running'), sb('sighted'), sb('blind')], 'agents', 1],
  [[step('sighted'), step('blind')], 'agents', 1],
  [[done('sighted', 'gate'), gone('sighted'), done('blind', 'no-progress'), gone('blind')], 'comparing', 2],
  [[sb('inspector')], 'inspecting', 2],
  [[gone('inspector'), phase('awaiting-fix')], 'awaiting-fix', 3],
  [[phase('fixing')], 'patching', 3],
  [[sb('rerun-1'), step('rerun-1')], 'verifying', 4],
  [[gone('rerun-1'), sb('inspector')], 'inspecting', 4],
  [[gone('inspector')], 'verifying', 4],
  [[phase('finished'), { t: 'run.finished', runId: R, outcome: 'verified', verified: true }], 'finished', 5],
];

test('stage follows a real run event by event, and the phase strip agrees', () => {
  let v: RunView = { ...emptyView(), queuePosition: 1 };
  for (const [events, stage, idx] of script) {
    v = events.reduce(reduce, v);
    if (stage !== 'queued') v = { ...v, queuePosition: undefined };
    expect(stageOf(v)).toBe(stage);
    const current = phaseSteps(v).findIndex((p) => p.state === 'current');
    expect(current === -1 ? 5 : current).toBe(idx);
  }
});

test('a run stopped during verification is stopped at Verify and says so', () => {
  const events: RunEvent[] = [phase('running'), sb('sighted'), sb('blind'), done('sighted', 'gate'), done('blind', 'no-progress'),
    phase('awaiting-fix'), phase('fixing'), sb('rerun-1'), step('rerun-1'), gone('rerun-1', 'stopped'), phase('finished'),
    { t: 'run.finished', runId: R, outcome: 'stopped', verified: false, error: 'Stopped by the person who started this run' }];
  const v = events.reduce(reduce, emptyView());
  expect(stageOf(v)).toBe('stopped');
  expect(phaseSteps(v).find((p) => p.state === 'stopped')?.key).toBe('verify');
  expect(nowLine(v, true, 0).stopped).toBe(true);
});

test('inspecting during a fix round explains that the fix got the agent further', () => {
  const v = [phase('running'), phase('awaiting-fix'), phase('fixing'), sb('rerun-1'), step('rerun-1'), sb('inspector')].reduce(reduce, emptyView());
  expect(nowLine(v, true, 0).text).toMatch(/^The fix got the blind agent further/);
});
