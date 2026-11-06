import type { AgentId, SandboxLimits } from '@earshot/shared';
import type { RunView } from '../reduce.js';

export const MAX_STEPS = 15;

export interface SandboxRow { agent: AgentId; steps: number; live: boolean; ended?: string }
export interface WorkState {
  sandboxes: SandboxRow[];
  started: number;
  live: number;
  blocked: number;
  lastBlocked?: { agent: AgentId; host: string };
  flagged: number;
  limits?: SandboxLimits;
  decision?: 'approved' | 'denied' | 'timeout';
  asked: boolean;
}

/** Everything the "where the work runs" views show, read from the run's own events. */
export function workState(view: RunView): WorkState {
  const sandboxes: SandboxRow[] = [];
  let limits: SandboxLimits | undefined;
  let blocked = 0;
  let flagged = 0;
  let lastBlocked: WorkState['lastBlocked'];
  let decision: WorkState['decision'];
  let asked = false;
  for (const e of view.containment) {
    if (e.t === 'sandbox.created') {
      limits ??= e.limits;
      if (!sandboxes.some((s) => s.agent === e.agent)) sandboxes.push({ agent: e.agent, steps: 0, live: true });
    } else if (e.t === 'containment.blocked') {
      blocked++;
      lastBlocked = { agent: e.agent, host: e.host };
    } else if (e.t === 'injection.flagged') flagged++;
    else if (e.t === 'approval.requested') asked = true;
    else if (e.t === 'approval.resolved') decision = e.decision;
  }
  for (const s of sandboxes) {
    const a = view.agents[s.agent];
    s.steps = a?.steps.length ?? 0;
    s.live = !!a?.sandbox && !a.sandbox.destroyed && !view.finished;
    s.ended = a?.sandbox?.destroyed;
  }
  const started = view.containment.filter((e) => e.t === 'sandbox.created').length;
  return { sandboxes, started, live: sandboxes.filter((s) => s.live).length, blocked, lastBlocked, flagged, limits, decision, asked };
}
