import type { AgentId, AgentOutcome } from '@earshot/shared';
import { reruns, type RunView } from '../reduce.js';
import { checkpointsFor, reachedCount } from '../narrative.js';

export interface JourneyRow { agent: AgentId; reached: number; endedAt?: { index: number; outcome: AgentOutcome }; blockedBy?: string }

/** One row per agent (sighted, blind, then reruns): checkpoints reached, where it ended, and the finding that blocks it. */
export function journeyRows(view: RunView): JourneyRow[] {
  const cps = checkpointsFor(view.meta?.mode);
  return (['sighted', 'blind', ...reruns(view)] as AgentId[]).map((agent) => {
    const reached = reachedCount(view, agent);
    const row: JourneyRow = { agent, reached };
    const outcome = view.agents[agent]?.outcome;
    if (outcome && outcome !== 'gate' && outcome !== 'done' && reached < cps.length) {
      row.endedAt = { index: reached, outcome };
      if (agent !== 'sighted') {
        const f = view.findings.find((x) => x.confirmed && x.milestone === cps[reached]!.id);
        if (f) row.blockedBy = f.id;
      }
    }
    return row;
  });
}
