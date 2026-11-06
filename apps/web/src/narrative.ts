import { modePolicy, type AgentId, type AgentOutcome, type FailureCategory, type Finding, type RunMode } from '@earshot/shared';
import { isPaused, isRerun, reruns, stageOf, type RunView, type Stage, type StepEvent } from './reduce.js';
import { actionText, agentName } from './labels.js';

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

/** How many of the run mode's checkpoints this agent has reached. */
export function reachedCount(view: RunView, agent: AgentId): number {
  const a = view.agents[agent];
  return a ? modePolicy(view.meta?.mode).reached({ milestones: a.milestones, steps: a.steps.length, outcome: a.outcome }) : 0;
}

export function nextCheckpoint(view: RunView, agent: AgentId): string | null {
  return modePolicy(view.meta?.mode).checkpoints[reachedCount(view, agent)]?.label ?? null;
}

/* ------------------------------------------------------------------ agent state */

export type Tone = 'live' | 'waiting' | 'done' | 'failed' | 'idle';

/** The last checkpoint's name: “Place order” on the store, “Submit” on Any URL. */
export const finalCheckpoint = (mode?: RunMode) => modePolicy(mode).checkpoints.at(-1)!.label;

const OUTCOME_STATE: Record<AgentOutcome, { label: string; reason: string; tone: Tone }> = {
  gate: { label: 'Made it', reason: 'Got all the way to the final button', tone: 'done' },
  done: { label: 'Finished', reason: 'Said the task is done', tone: 'done' },
  stuck: { label: 'Gave up', reason: 'Decided it could not go any further', tone: 'failed' },
  timeout: { label: 'Out of time', reason: 'Used up its whole time limit', tone: 'failed' },
  'max-steps': { label: 'Out of steps', reason: 'Used all 15 steps without finishing', tone: 'failed' },
  'no-progress': { label: 'Stuck', reason: 'Three actions in a row changed nothing on the page', tone: 'failed' },
  error: { label: 'Broke down', reason: 'Its browser or the AI model failed (not counted as a finding)', tone: 'failed' },
  stopped: { label: 'Stopped', reason: 'The person who started this run stopped it', tone: 'idle' },
};

export function agentState(view: RunView, agent: AgentId, now: number): { label: string; reason: string; tone: Tone } {
  const a = view.agents[agent];
  if (a?.outcome === 'gate') return { ...OUTCOME_STATE.gate, reason: `Reached the final “${finalCheckpoint(view.meta?.mode)}” button` };
  if (a?.outcome) return OUTCOME_STATE[a.outcome];
  if (view.finished && view.stopped) return OUTCOME_STATE.stopped;
  if (!a?.sandbox) return { label: 'Starting', reason: 'Its sandbox is being created', tone: 'idle' };
  if (a.sandbox.destroyed) return { label: 'Ended', reason: `Sandbox ${a.sandbox.destroyed}`, tone: 'idle' };
  if (view.approval?.agent === agent) return { label: 'Waiting for a person', reason: `Reached “${finalCheckpoint(view.meta?.mode)}”; a human must approve the final click`, tone: 'waiting' };
  if (isPaused(view, now)) return { label: 'Paused', reason: 'Waits before its next step', tone: 'waiting' };
  const next = nextCheckpoint(view, agent);
  return { label: `Working · step ${a.steps.length + 1}`, reason: next ? `Trying to reach ${next}` : 'Looking for the final button', tone: 'live' };
}

/* ------------------------------------------------------------------ phases */

export type PhaseKey = 'queue' | 'agents' | 'compare' | 'fix' | 'verify';
export interface PhaseStep { key: PhaseKey; label: string; desc: string; state: 'done' | 'current' | 'upcoming' | 'skipped' | 'stopped'; note?: string }

const PHASES: { key: PhaseKey; label: string; desc: string }[] = [
  { key: 'queue', label: 'Wait for a slot', desc: 'Runs take turns on the Vultr server. Yours starts by itself.' },
  { key: 'agents', label: 'Both agents try', desc: 'Each one drives a real Chrome browser inside its own sealed sandbox.' },
  { key: 'compare', label: 'Find what broke', desc: 'If the blind agent stopped early, a fresh sandbox checks the exact element that blocked it.' },
  { key: 'fix', label: 'Write a fix', desc: 'AI suggests a small fix: labels and roles only, never new code.' },
  { key: 'verify', label: 'Test the fix', desc: 'A fresh blind agent tries again. The fix only counts if it gets further.' },
];

/** Index into PHASES of the current stage; a stopped run reports where it was when stopped. */
function phaseIndex(view: RunView, stage: Stage): number {
  switch (stage) {
    case 'finished': return PHASES.length;
    case 'patching': case 'verifying': return reruns(view).length > 0 ? 4 : 3;
    case 'awaiting-fix': return 3;
    case 'inspecting': return view.phase === 'fixing' ? 4 : 2;
    case 'comparing': return 2;
    case 'agents': return 1;
    case 'stopped': {
      // stopped: the furthest stage reached, from what is on record
      if (reruns(view).length || Object.keys(view.fixes).length) return reruns(view).length ? 4 : 3;
      if (view.phase === 'awaiting-fix' || view.phase === 'fixing') return 3;
      if (view.agents.inspector || (view.agents.sighted?.outcome && view.agents.blind?.outcome)) return 2;
      return view.agents.sighted || view.agents.blind ? 1 : 0;
    }
    default: return 0;
  }
}

export function phaseSteps(view: RunView): PhaseStep[] {
  const confirmed = view.findings.some((f) => f.confirmed);
  const fixStarted = reruns(view).length > 0 || Object.keys(view.fixes).length > 0;
  const idx = phaseIndex(view, stageOf(view));

  if (view.stopped) {
    return PHASES.map((p, i): PhaseStep => (i < idx ? { ...p, state: 'done' } : i === idx ? { ...p, state: 'stopped', note: 'Stopped here' } : { ...p, state: 'skipped' }));
  }
  return PHASES.map((p, i) => {
    const base: PhaseStep = { ...p, state: i < idx ? 'done' : i === idx ? 'current' : 'upcoming' };
    if (p.key !== 'fix' && p.key !== 'verify') return base;
    if (!modePolicy(view.meta?.mode).fixable) return { ...base, state: 'skipped', note: 'Skipped: Earshot never changes other people’s sites' };
    if (view.finished && !fixStarted) {
      if (view.stopped) return { ...base, state: 'skipped', note: 'Stopped' };
      return { ...base, state: 'skipped', note: confirmed ? 'Skipped: not started' : 'Skipped: nothing to fix' };
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
    const final = finalCheckpoint(view.meta?.mode);
    if (view.finished.verified) {
      return reruns(view).length
        ? { text: 'Fixed and proven: the blind agent now gets all the way through.', next: `With the fix applied, a fresh blind agent reached “${final}”.` }
        : { text: 'Done. Both agents got all the way through.', next: 'The blind agent got as far as the seeing one, so nothing on this path blocks a screen-reader user.' };
    }
    return {
      text: 'Done. The blind agent could not finish the task.',
      next: confirmed ? `Earshot found ${confirmed === 1 ? 'the element' : `${confirmed} elements`} that blocked it. See “What blocked the blind agent” below.` : undefined,
    };
  }
  if (view.queuePosition) return { text: `Waiting for a free sandbox slot (position ${view.queuePosition}).`, next: 'Your run starts automatically.' };
  if (view.approval) {
    const who = lower(agentName(view.approval.agent));
    const left = secs(view.approval.requestedAt + 60_000 - now);
    return isStarter
      ? { needsYou: 'approval', text: `Needs you: the ${who} agent wants to place the order.`, next: `Approve or deny within ${left}. Nothing is charged.` }
      : { text: `The ${who} agent is waiting for the person who started this run to approve the order.`, next: `Denied automatically in ${left}.` };
  }
  if (isPaused(view, now)) return { text: `Paused. Resumes automatically in ${secs(view.paused!.resumeAt - now)}.`, next: 'The sandbox time limits keep counting down while paused.' };
  if (view.phase === 'awaiting-fix') {
    const next = view.fixDeadlineAt ? `Available for ${mmss(view.fixDeadlineAt - now)}.` : undefined;
    return isStarter
      ? { needsYou: 'fix', text: `Needs you: Earshot found ${confirmed === 1 ? 'what blocked' : `${confirmed} things that blocked`} the blind agent. Start Fix & verify to repair it and try again.`, next }
      : { text: 'Waiting for the person who started this run to start Fix & verify.', next };
  }
  const stage = stageOf(view);
  const last = latestStep(view);
  if (stage === 'patching') {
    return { text: 'Writing a small fix with AI on Vultr Serverless Inference (labels and roles only).', next: 'Next, a fresh blind agent tries again in a new sandbox with the fix applied.' };
  }
  if (stage === 'inspecting') {
    const at = nextCheckpoint(view, last && isRerun(last.agent) ? last.agent : 'blind');
    const lead = view.phase === 'fixing' ? 'The fix got the blind agent further.' : 'Both agents finished.';
    return { text: `${lead} ${at ? `It got stuck before ${at}. A` : 'A'} fresh sandbox is now checking exactly why.`, next: 'It repeats what the seeing agent did and tests that element like a screen reader would: does it have a name, a role, and work with the keyboard?' };
  }
  if (stage === 'comparing') {
    return { text: 'Both agents finished. Comparing how far each one got.' };
  }
  if (last) {
    const next = nextCheckpoint(view, last.agent);
    const who = isRerun(last.agent) ? `Verification ${agentName(last.agent).toLowerCase()}` : `${agentName(last.agent)} agent`;
    return { text: `${who}, step ${last.index + 1}: ${plainAction(last)}.`, next: next ? `Next checkpoint: ${next}.` : undefined };
  }
  if (view.agents.sighted?.sandbox || view.agents.blind?.sandbox) return { text: 'Starting two sandboxes on the Vultr server.', next: 'Each one opens a real Chrome browser. The agents start as soon as the page loads.' };
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

export function findingTitle(f: Finding, mode?: RunMode): string {
  const name = elementName(f.element.snippet);
  const cp = modePolicy(mode).label(f.milestone);
  return f.confirmed ? `${name} can’t be used without sight · blocks ${cp}` : `Not confirmed: ${name} · ${cp}`;
}

/* ------------------------------------------------------------------ glossary */

export const GLOSSARY: Record<string, string> = {
  queue: 'Runs take turns on the Vultr server. A waiting run starts by itself when a slot frees up.',
  agents: 'Both agents get the same task and the same AI model (on Vultr Serverless Inference). Each one drives a real Chrome browser in its own sealed sandbox on a Vultr server. One sees screenshots; the other only gets what a screen reader would read out.',
  compare: 'Earshot finds the first checkpoint the seeing agent passed and the blind agent did not. A fresh sandbox repeats the seeing agent’s steps and tests that element: does it have a name, a role, keyboard access and a label?',
  fix: 'AI on Vultr Serverless Inference suggests a small fix that only changes attributes like role or aria-label. A fixed template applies it, so the AI can never inject its own code.',
  verify: 'A fresh blind agent runs the task again with the fix applied. The fix only counts if it gets past the point where it was blocked.',
  gate: 'The agent reached the final button. Clicking it always needs a real person, so reaching it counts as finishing the task.',
  done: 'The agent said it finished the task.',
  stuck: 'The agent decided it could not go any further.',
  timeout: 'Each agent has a hard time limit. This one ran out of time.',
  'max-steps': 'Each agent may take at most 15 steps. This one used them all.',
  'no-progress': 'Three actions in a row changed nothing on the page, so Earshot stopped the agent.',
  error: 'The browser or the AI model failed. Runs like this are never counted as accessibility problems.',
  stopped: 'The person who started this run pressed Stop. All sandboxes were deleted.',
  checkpoint: 'A point along the way to the goal, read from the real page, not from what the agent claims.',
  sandbox: 'A sealed, throwaway container (gVisor) on the Vultr server. It has no secret keys, limited memory and CPU, and a hard time limit, and it is deleted when the agent ends.',
  'egress proxy': 'The sandbox’s only way to the internet. It lets through the site being tested and the AI model, and blocks everything else, including the cloud server’s private metadata address.',
  'accessibility tree': 'What a screen reader reads out: each element’s role, name and state, without any of the visual layout.',
};
