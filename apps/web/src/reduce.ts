import type { AgentId, AgentOutcome, Finding, MilestoneId, Patch, RunEvent, RunMode, SandboxLimits } from '@earshot/shared';

export type StepEvent = Extract<RunEvent, { t: 'step' }>;
export type RailEvent = Extract<RunEvent, { t: 'sandbox.created' | 'sandbox.destroyed' | 'containment.blocked' | 'approval.requested' | 'approval.resolved' | 'injection.flagged' }>;

export interface AgentView {
  steps: StepEvent[];
  milestones: MilestoneId[];
  outcome?: AgentOutcome;
  sandbox?: { id: string; limits: SandboxLimits; destroyed?: 'finished' | 'timeout' | 'error' };
}

export interface FixAttempt { attempt: number; verified: boolean; diff: string; patch: Patch }

export interface RunView {
  meta?: { runId: string; mode: RunMode; goal: string; target: string };
  queuePosition?: number;
  agents: Partial<Record<AgentId, AgentView>>;
  containment: RailEvent[];
  findings: Finding[];
  fixes: Record<string, FixAttempt[]>;
  approval?: { approvalId: string; agent: AgentId; element: Extract<RunEvent, { t: 'approval.requested' }>['element']; requestedAt: number };
  finished?: { verified: boolean; error?: string };
}

export const emptyView = (): RunView => ({ agents: {}, containment: [], findings: [], fixes: {} });

const agentOf = (v: RunView, id: AgentId): AgentView => v.agents[id] ?? { steps: [], milestones: [] };

/** Pure event fold for the live run page. Never mutates `view`. */
export function reduce(view: RunView, e: RunEvent): RunView {
  switch (e.t) {
    case 'run.created':
      return { ...view, meta: { runId: e.runId, mode: e.mode, goal: e.goal, target: e.target } };
    case 'run.queued':
      return { ...view, queuePosition: e.position };
    case 'step': {
      const a = agentOf(view, e.agent);
      return { ...view, queuePosition: undefined, agents: { ...view.agents, [e.agent]: { ...a, steps: [...a.steps, e], milestones: e.milestones.length >= a.milestones.length ? e.milestones : a.milestones } } };
    }
    case 'agent.finished': {
      const a = agentOf(view, e.agent);
      return { ...view, agents: { ...view.agents, [e.agent]: { ...a, outcome: e.outcome, milestones: e.milestones.length >= a.milestones.length ? e.milestones : a.milestones } } };
    }
    case 'sandbox.created': {
      const a = agentOf(view, e.agent);
      return { ...view, queuePosition: undefined, containment: [...view.containment, e], agents: { ...view.agents, [e.agent]: { ...a, sandbox: { id: e.containerId, limits: e.limits } } } };
    }
    case 'sandbox.destroyed': {
      const a = agentOf(view, e.agent);
      const sandbox = a.sandbox ? { ...a.sandbox, destroyed: e.reason } : undefined;
      return { ...view, containment: [...view.containment, e], agents: { ...view.agents, [e.agent]: { ...a, sandbox } } };
    }
    case 'containment.blocked':
    case 'injection.flagged':
      return { ...view, containment: [...view.containment, e] };
    case 'approval.requested':
    case 'approval.resolved':
      return { ...view, containment: [...view.containment, e] };
    case 'run.finished':
      return { ...view, finished: e.error ? { verified: e.verified, error: e.error } : { verified: e.verified } };
    default:
      return view;
  }
}

/** Verification reruns in order: the third column. */
export function reruns(view: RunView): AgentId[] {
  return (Object.keys(view.agents) as AgentId[])
    .filter((k) => k.startsWith('rerun-'))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}
