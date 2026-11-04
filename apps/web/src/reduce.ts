import type { AgentId, AgentOutcome, Finding, MilestoneId, Patch, RunEvent, RunMode, RunPhase, SandboxLimits } from '@earshot/shared';

/** run.finished.error when the starter pressed Stop (matches the control server). */
export const STOP_ERROR = 'Stopped by the person who started this run';

export type StepEvent = Extract<RunEvent, { t: 'step' }>;
export type RailEvent = Extract<RunEvent, { t: 'sandbox.created' | 'sandbox.destroyed' | 'containment.blocked' | 'approval.requested' | 'approval.resolved' | 'injection.flagged' }>;

export interface AgentView {
  steps: StepEvent[];
  milestones: MilestoneId[];
  outcome?: AgentOutcome;
  sandbox?: { id: string; limits: SandboxLimits; destroyed?: 'finished' | 'timeout' | 'error' | 'stopped' };
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
  phase?: RunPhase;
  fixDeadlineAt?: number;
  paused?: { resumeAt: number };
  stopped?: boolean;
  /** The most recent step across all agents (drives the Now banner and follow-live). */
  lastStep?: { agent: AgentId; index: number };
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
      return { ...view, queuePosition: undefined, lastStep: { agent: e.agent, index: e.index }, agents: { ...view.agents, [e.agent]: { ...a, steps: [...a.steps, e], milestones: e.milestones.length >= a.milestones.length ? e.milestones : a.milestones } } };
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
      return { ...view, containment: [...view.containment, e], approval: { approvalId: e.approvalId, agent: e.agent, element: e.element, requestedAt: Date.now() } };
    case 'approval.resolved':
      return { ...view, containment: [...view.containment, e], approval: view.approval?.approvalId === e.approvalId ? undefined : view.approval };
    case 'finding': {
      const i = view.findings.findIndex((f) => f.id === e.finding.id);
      const findings = i >= 0 ? view.findings.map((f, j) => (j === i ? e.finding : f)) : [...view.findings, e.finding];
      return { ...view, findings };
    }
    case 'fix.result': {
      const list = [...(view.fixes[e.findingId] ?? []), { attempt: e.attempt, verified: e.verified, diff: e.diff, patch: e.patch }];
      const findings = view.findings.map((f) => (f.id === e.findingId ? { ...f, status: e.verified ? 'verified' as const : 'fixing' as const } : f));
      return { ...view, findings, fixes: { ...view.fixes, [e.findingId]: list } };
    }
    case 'run.phase':
      return { ...view, phase: e.phase, fixDeadlineAt: e.phase === 'awaiting-fix' ? e.fixDeadlineAt : undefined };
    case 'run.paused':
      return { ...view, paused: { resumeAt: e.resumeAt } };
    case 'run.resumed':
      return { ...view, paused: undefined };
    case 'run.finished':
      return { ...view, paused: undefined, approval: undefined, stopped: e.error === STOP_ERROR || undefined, finished: e.error ? { verified: e.verified, error: e.error } : { verified: e.verified } };
    default:
      return view;
  }
}

/** True while a pause is in effect; a replayed pause whose auto-resume time has passed no longer counts. */
export function isPaused(view: RunView, now: number): boolean {
  return !!view.paused && view.paused.resumeAt > now && !view.finished;
}

/** Verification reruns in order: the third column. */
export function reruns(view: RunView): AgentId[] {
  return (Object.keys(view.agents) as AgentId[])
    .filter((k) => k.startsWith('rerun-'))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}
