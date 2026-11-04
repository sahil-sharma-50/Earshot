import { DEMO_MILESTONES, type AgentId, type AgentOutcome, type FailureCategory, type Finding, type MilestoneId, type RunMode } from '@earshot/shared';
import { isPaused, reruns, type RunView, type StepEvent } from './reduce.js';
import { actionText, agentName, MILESTONE_LABEL } from './labels.js';

/* ------------------------------------------------------------------ helpers */

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const secs = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))} s`;
const mmss = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** What a person would call an element: its visible text in quotes, or "an unlabeled <tag>". */
export function elementName(snippet: string): string {
  // snippets are cut at 300 chars, sometimes inside a tag: drop that unfinished tag too
  const text = snippet.replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, ' ').replace(/\s+/g, ' ').trim();
  if (text) return `“${text.length > 40 ? text.slice(0, 39) + '…' : text}”`;
  const tag = /^<([a-z0-9-]+)/i.exec(snippet)?.[1]?.toLowerCase() ?? 'element';
  return `an unlabeled ${tag}`;
}

const FOCUS_KEYS = new Set(['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function targetName(step: StepEvent, target: string): string {
  if (step.result.element) return elementName(step.result.element.snippet);
  return step.agent === 'sighted' ? `marked element ${target}` : `tree item ${target}`;
}

/* ------------------------------------------------------------------ steps */

export function plainAction(step: StepEvent): string {
  const a = step.action;
  switch (a.type) {
    case 'click': return `Clicked ${targetName(step, a.target)}`;
    case 'type': return `Typed “${a.text}” into ${targetName(step, a.target)}`;
    case 'select': return `Chose “${a.option}” in ${targetName(step, a.target)}`;
    case 'press':
      return step.result.element && FOCUS_KEYS.has(a.key)
        ? `Pressed ${a.key} (focus moved to ${elementName(step.result.element.snippet)})`
        : `Pressed ${a.key}`;
    case 'scroll': return `Scrolled ${a.direction}`;
    case 'navigate': return `Went to ${a.url}`;
    case 'done': return 'Said the goal is done';
    case 'stuck': return `Gave up: ${a.reason}`;
    default: return actionText(a);
  }
}

const ERROR_TEXT: Record<string, string> = {
  'not-actionable': 'That element can’t be operated',
  'unknown-target': 'The agent pointed at something that isn’t on the page',
  timeout: 'The page didn’t respond in time',
  'navigation-blocked': 'Leaving the allowed site is blocked',
  'approval-denied': 'Purchase not approved',
  'approval-timeout': 'Purchase not approved (no answer in 60 s)',
  'model-no-tool-call': 'The model didn’t choose an action',
  'model-bad-args': 'The model chose an invalid action',
};

export function plainResult(step: StepEvent): { ok: boolean; text: string } {
  if (step.result.ok) return { ok: true, text: 'Done' };
  const code = step.result.error ?? '';
  return { ok: false, text: ERROR_TEXT[code] ?? (code || 'Failed') };
}

/* ------------------------------------------------------------------ checkpoints */

export interface Checkpoint { id: MilestoneId; label: string }

export function checkpointsFor(mode: RunMode | undefined): Checkpoint[] {
  if (mode === 'any-url') return [{ id: 'on_product_page', label: 'Start' }, { id: 'awaiting_final_approval', label: 'Submit' }];
  return DEMO_MILESTONES.map((id) => ({ id, label: MILESTONE_LABEL[id] }));
}

/** How many checkpoints (in `checkpointsFor` order) this agent has reached. */
export function reachedCount(view: RunView, agent: AgentId): number {
  const a = view.agents[agent];
  if (!a) return 0;
  if (view.meta?.mode === 'any-url') {
    if (a.milestones.includes('awaiting_final_approval') || a.outcome === 'gate') return 2;
    return a.steps.length > 0 ? 1 : 0;
  }
  return a.milestones.length;
}

export function nextCheckpoint(view: RunView, agent: AgentId): string | null {
  const cps = checkpointsFor(view.meta?.mode);
  return cps[reachedCount(view, agent)]?.label ?? null;
}

/* ------------------------------------------------------------------ agent state */

export type Tone = 'live' | 'waiting' | 'done' | 'failed' | 'idle';

const OUTCOME_STATE: Record<AgentOutcome, { label: string; reason: string; tone: Tone }> = {
  gate: { label: 'Reached Place order', reason: 'Got all the way to the final button', tone: 'done' },
  done: { label: 'Finished', reason: 'Said the goal is done', tone: 'done' },
  stuck: { label: 'Gave up', reason: 'The agent decided it could not continue', tone: 'failed' },
  timeout: { label: 'Out of time', reason: 'Used its whole 120 s time budget', tone: 'failed' },
  'max-steps': { label: 'Out of steps', reason: 'Used all 15 steps without finishing', tone: 'failed' },
  'no-progress': { label: 'Stalled', reason: 'Three actions in a row changed nothing on the page', tone: 'failed' },
  error: { label: 'Run error', reason: 'The agent’s browser or model call failed', tone: 'failed' },
  stopped: { label: 'Stopped', reason: 'The person who started this run stopped it', tone: 'idle' },
};

export function agentState(view: RunView, agent: AgentId, now: number): { label: string; reason: string; tone: Tone } {
  const a = view.agents[agent];
  if (a?.outcome) return OUTCOME_STATE[a.outcome];
  if (view.finished && view.stopped) return OUTCOME_STATE.stopped;
  if (!a?.sandbox) return { label: 'Starting', reason: 'Waiting for a sandbox', tone: 'idle' };
  if (a.sandbox.destroyed) return { label: 'Ended', reason: `Sandbox ${a.sandbox.destroyed}`, tone: 'idle' };
  if (view.approval?.agent === agent) return { label: 'Waiting for approval', reason: 'Reached Place order; a person must approve the purchase', tone: 'waiting' };
  if (isPaused(view, now)) return { label: 'Paused', reason: 'Waits before its next step', tone: 'waiting' };
  const next = nextCheckpoint(view, agent);
  return { label: `Running · step ${a.steps.length + 1}`, reason: next ? `Heading for ${next}` : 'Looking for the final button', tone: 'live' };
}

/* ------------------------------------------------------------------ phases */

export type PhaseKey = 'queue' | 'agents' | 'compare' | 'fix' | 'verify';
export interface PhaseStep { key: PhaseKey; label: string; state: 'done' | 'current' | 'upcoming' | 'skipped' | 'stopped'; note?: string }

const PHASES: { key: PhaseKey; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'agents', label: 'Run agents' },
  { key: 'compare', label: 'Compare & confirm' },
  { key: 'fix', label: 'Fix' },
  { key: 'verify', label: 'Verify' },
];

export function phaseSteps(view: RunView): PhaseStep[] {
  const confirmed = view.findings.some((f) => f.confirmed);
  const fixStarted = reruns(view).length > 0 || Object.keys(view.fixes).length > 0;
  let idx: number;
  if (view.finished && !view.stopped) idx = PHASES.length;
  else if (view.phase === 'fixing') idx = reruns(view).length > 0 ? 4 : 3;
  else if (view.phase === 'awaiting-fix') idx = 3;
  else if (view.agents.inspector || (view.agents.sighted?.outcome && view.agents.blind?.outcome)) idx = 2;
  else if (view.phase === 'running' || view.agents.sighted || view.agents.blind) idx = 1;
  else idx = 0;

  if (view.stopped) {
    return PHASES.map((p, i) => (i < idx ? { ...p, state: 'done' } : i === idx ? { ...p, state: 'stopped', note: 'Stopped here' } : { ...p, state: 'skipped' }));
  }
  return PHASES.map((p, i) => {
    const base: PhaseStep = { ...p, state: i < idx ? 'done' : i === idx ? 'current' : 'upcoming' };
    if (p.key !== 'fix' && p.key !== 'verify') return base;
    if (view.meta?.mode === 'any-url') return { ...base, state: 'skipped', note: 'Findings only' };
    if (view.finished && !fixStarted) {
      if (view.stopped) return { ...base, state: 'skipped', note: 'Stopped' };
      return { ...base, state: 'skipped', note: confirmed ? 'Not started' : 'Not needed' };
    }
    return base;
  });
}

/* ------------------------------------------------------------------ now banner */

export interface NowLine { text: string; next?: string; needsYou?: 'approval' | 'fix'; stopped?: boolean }

const latestStep = (view: RunView): StepEvent | undefined => {
  const l = view.lastStep;
  return l ? view.agents[l.agent]?.steps.find((s) => s.index === l.index) : undefined;
};

export function nowLine(view: RunView, isStarter: boolean, now: number): NowLine {
  const confirmed = view.findings.filter((f) => f.confirmed).length;
  if (view.finished) {
    if (view.stopped) {
      const n = view.containment.filter((e) => e.t === 'sandbox.created').length;
      return {
        stopped: true,
        text: isStarter ? 'You stopped this run.' : 'The person who started this run stopped it.',
        next: `Both agents were halted and all ${n} sandbox${n === 1 ? ' was' : 'es were'} destroyed. Nothing else will happen on this run.`,
      };
    }
    if (view.finished.error) return { text: `Run ended: ${view.finished.error}` };
    if (view.finished.verified) {
      return { text: 'Journey verified end to end.', next: reruns(view).length ? 'The blind agent reached Place order with the fixes applied.' : 'Both agents completed the journey.' };
    }
    return { text: 'Run finished. The blind agent did not complete the journey.', next: confirmed ? `${confirmed} confirmed finding${confirmed > 1 ? 's' : ''} below.` : undefined };
  }
  if (view.queuePosition) return { text: `Waiting for a free sandbox slot (position ${view.queuePosition}).`, next: 'Your run starts automatically.' };
  if (view.approval) {
    const who = lower(agentName(view.approval.agent));
    const left = secs(view.approval.requestedAt + 60_000 - now);
    return isStarter
      ? { needsYou: 'approval', text: `Needs you: the ${who} agent wants to place the order.`, next: `Approve or deny within ${left}. Nothing is charged.` }
      : { text: `The ${who} agent is waiting for the person who started this run to approve the order.`, next: `Denied automatically in ${left}.` };
  }
  if (isPaused(view, now)) return { text: `Paused. Resumes automatically in ${secs(view.paused!.resumeAt - now)}.`, next: 'Sandbox time caps keep running.' };
  if (view.phase === 'awaiting-fix') {
    const next = view.fixDeadlineAt ? `Available for ${mmss(view.fixDeadlineAt - now)}.` : undefined;
    return isStarter
      ? { needsYou: 'fix', text: `Needs you: ${confirmed} confirmed finding${confirmed === 1 ? '' : 's'}. Start Fix & verify to patch it and rerun the blind agent.`, next }
      : { text: 'Waiting for the person who started this run to start Fix & verify.', next };
  }
  const last = latestStep(view);
  if (view.phase === 'fixing' && !(last && last.agent.startsWith('rerun-'))) {
    return { text: 'Writing an attribute-only patch with Vultr Serverless Inference.', next: 'A fresh sandbox will rerun the blind agent with the patch applied.' };
  }
  if (view.agents.inspector?.sandbox && !view.agents.inspector.sandbox.destroyed) {
    const at = nextCheckpoint(view, 'blind');
    return { text: `Both agents finished. ${at ? `The blind agent got stuck before ${at}; an` : 'An'} inspector sandbox is confirming why.`, next: 'It replays the sighted path and checks the element’s role, name, keyboard access and label.' };
  }
  if (view.agents.sighted?.outcome && view.agents.blind?.outcome && view.phase !== 'fixing' && !(last && last.agent.startsWith('rerun-'))) {
    return { text: 'Both agents finished. Comparing their journeys to find where they diverged.' };
  }
  if (last) {
    const next = nextCheckpoint(view, last.agent);
    const who = last.agent.startsWith('rerun-') ? `Verification ${agentName(last.agent).toLowerCase()}` : `${agentName(last.agent)} agent`;
    return { text: `${who}, step ${last.index + 1}: ${plainAction(last)}.`, next: next ? `Next checkpoint: ${next}.` : undefined };
  }
  if (view.agents.sighted?.sandbox || view.agents.blind?.sandbox) return { text: 'Starting two sandboxes on the Vultr VM.', next: 'The agents begin as soon as their browsers load the store.' };
  return { text: 'Connecting to the run…' };
}

/* ------------------------------------------------------------------ findings */

export const CATEGORY_EXPLAIN: Record<FailureCategory, { wrong: string; impact: string; fix: string }> = {
  'not-exposed': {
    wrong: 'The element is missing from the accessibility tree, so assistive technology never announces it.',
    impact: 'A screen-reader user cannot find this control at all.',
    fix: 'Use a native element (button, input, link) or expose it with a proper role and name.',
  },
  'no-name': {
    wrong: 'The control has no accessible name.',
    impact: 'A screen reader announces only “button” or “link”, so the user cannot tell what it does.',
    fix: 'Give it a name: visible text, aria-label or aria-labelledby.',
  },
  'wrong-role': {
    wrong: 'It looks like a control but is announced as plain text.',
    impact: 'A screen-reader user hears text, not something they can activate.',
    fix: 'Use a real button or give it a matching role (for example role="radio" in a radiogroup).',
  },
  'not-keyboard-operable': {
    wrong: 'It only reacts to a mouse click; it can’t be reached or used with the keyboard.',
    impact: 'Keyboard and screen-reader users cannot operate it.',
    fix: 'Make it focusable (tabindex="0") and respond to Enter and Space, or use a native control.',
  },
  'unlabeled-field': {
    wrong: 'The form field has no label tied to it.',
    impact: 'A screen-reader user does not know what to type.',
    fix: 'Connect a <label for> or aria-labelledby to the field.',
  },
};

export const WCAG_NAME: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  '1.3.1': 'Info and Relationships',
  '1.3.2': 'Meaningful Sequence',
  '2.1.1': 'Keyboard',
  '2.4.3': 'Focus Order',
  '2.4.4': 'Link Purpose (In Context)',
  '2.4.6': 'Headings and Labels',
  '3.3.2': 'Labels or Instructions',
  '4.1.2': 'Name, Role, Value',
};

export function findingTitle(f: Finding): string {
  const name = elementName(f.element.snippet);
  const cp = MILESTONE_LABEL[f.milestone as MilestoneId] ?? f.milestone;
  return f.confirmed ? `${name} can’t be used without sight · blocks ${cp}` : `Not confirmed: ${name} · ${cp}`;
}

/* ------------------------------------------------------------------ glossary */

export const GLOSSARY: Record<string, string> = {
  queue: 'Runs take turns on the Vultr VM. A waiting run starts automatically when a slot frees up.',
  agents: 'Two agents get the same goal and the same model on Vultr Serverless Inference. Each runs a real browser in its own gVisor sandbox on Vultr Cloud Compute. One sees screenshots; the other gets only the accessibility tree.',
  compare: 'Earshot finds the first checkpoint the sighted agent passed and the blind agent did not. A fresh inspector sandbox replays the sighted path and checks the element: role, name, keyboard access, label and axe-core rules.',
  fix: 'Vultr Serverless Inference proposes an attribute-only patch (role, aria-label, tabindex…). It is applied by a fixed template, never as free-form code.',
  verify: 'A fresh blind agent reruns the journey with the patches applied. The fix only counts if it gets past the checkpoint that was blocked.',
  gate: 'The agent reached the final Place order button. Pressing it always needs a human, so reaching it counts as completing the journey.',
  done: 'The agent said it completed the goal.',
  stuck: 'The agent said it could not continue.',
  timeout: 'Each agent has 120 s. This one ran out.',
  'max-steps': 'Each agent may take at most 15 steps. This one used them all.',
  'no-progress': 'Three actions in a row changed nothing on the page, so the agent was stopped.',
  error: 'The browser or a model call failed. These runs are not counted as accessibility findings.',
  stopped: 'The person who started this run pressed Stop. All sandboxes were destroyed.',
  checkpoint: 'A point in the shopping journey, checked from the store’s real state, not from what the agent says.',
  sandbox: 'A disposable gVisor container with no secrets, 1 GiB memory, 0.75 CPU, a process limit and a hard time cap. It is destroyed when the agent ends.',
  'egress proxy': 'The sandbox’s only way out. It allows the demo store and the model endpoint for this run and blocks everything else, including the cloud metadata address.',
  'accessibility tree': 'What a screen reader reads: each element’s role, name and state, without the visual layout.',
};
