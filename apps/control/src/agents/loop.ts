import { modePolicy, type Action, type ActResult, type AgentId, type AgentKind, type AgentOutcome, type AxNodeView, type ElementIdentity, type MilestoneId, type Observation, type Probe, type RunEvent, type RunMode, type VisionCheck } from '@earshot/shared';
import type { ChatMessage, Inference, ToolDef } from '../inference/client.js';
import type { Sandbox } from '../sandbox/docker.js';
import { describeAction, parseAction, toolsFor } from './tools.js';
import { renderObservation, systemPrompt } from './prompts.js';
import { StoppedError } from '../runs/control.js';

export type GateDecision = 'approved' | 'denied' | 'timeout';

export interface AgentLimits { maxSteps: number; wallMs: number; noProgress: number }
export const DEFAULT_LIMITS: AgentLimits = { maxSteps: 15, wallMs: 120_000, noProgress: 3 };

export interface AgentContext {
  runId: string;
  agent: AgentId;
  kind: AgentKind;
  mode: RunMode;
  goal: string;
  sandbox: Sandbox;
  inference: Inference;
  emit: (e: RunEvent) => void;
  storeShot: (png: Buffer) => string;
  seenInjectionTexts?: Set<string>;
  /** Asks a person to approve the final action, showing them the vision check. */
  gate: (identity: ElementIdentity, check: VisionCheck) => Promise<GateDecision>;
  milestonesOf: (probe: Probe, gate: boolean) => MilestoneId[];
  limits?: AgentLimits;
  /** Pause/stop gate, awaited before every step. Throws StoppedError when the run is stopped. */
  checkpoint?: () => Promise<void>;
}

export interface RecordedStep { index: number; action: Action; result: ActResult; milestonesAfter: MilestoneId[]; axExcerpt?: AxNodeView[]; shotId?: string; reasoning: string; url: string }
export interface AgentResult { outcome: AgentOutcome; steps: RecordedStep[]; milestones: MilestoneId[] }

const RETRY_NUDGE = 'You must call exactly one tool. Reply with a single tool call.';
const INJECTION_MIN_LEN = 80;
const EXCERPT_MAX = 80;
/** Key presses that move focus; the newly focused element is recorded on the step. */
const FOCUS_KEYS = new Set<string>(['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Screens long page texts the run has not seen yet for prompt injection, all in parallel. A flag is
 * an event for viewers, never an input to the agent. Never throws.
 */
async function screenForInjection(ctx: AgentContext, nodes: AxNodeView[], seen: Set<string>): Promise<void> {
  if (!ctx.inference.flagInjection) return;
  const fresh = [...new Set(nodes.map((n) => n.name).filter((t) => t.length > INJECTION_MIN_LEN && !seen.has(t)))];
  for (const t of fresh) seen.add(t);
  await Promise.all(fresh.map(async (text) => {
    const flagged = await ctx.inference.flagInjection!(text).catch(() => false);
    if (flagged) ctx.emit({ t: 'injection.flagged', runId: ctx.runId, agent: ctx.agent, text });
  }));
}

function longer(a: MilestoneId[], b: MilestoneId[]): MilestoneId[] {
  return b.length > a.length ? b : a;
}

/** What one step perceived. `screening` settles once injection screening of this view is done. */
interface Perception { obs: Observation; shotId?: string; axExcerpt?: AxNodeView[]; screening: Promise<void> }

/** Observes the page. The sighted agent's screenshot is stored; the blind agent's tree is screened in the background. */
async function perceive(ctx: AgentContext, seen: Set<string>): Promise<Perception> {
  const obs = await ctx.sandbox.rpc.call({ m: 'observe', kind: ctx.kind });
  if (obs.kind === 'sighted') return { obs, shotId: ctx.storeShot(Buffer.from(obs.screenshotPng, 'base64')), screening: Promise.resolve() };
  // injection screening runs alongside the model's choice instead of before it (it used to eat the step budget)
  return { obs, axExcerpt: obs.nodes.slice(0, EXCERPT_MAX), screening: screenForInjection(ctx, obs.nodes, seen) };
}

type Choice = { action: Action; reasoning: string } | { action: null; reasoning: string; error: string };

/** Asks the model for exactly one action, with one corrective retry. */
async function choose(ctx: AgentContext, prompt: { system: string; tools: ToolDef[] }, obs: Observation, history: string[]): Promise<Choice> {
  const preface = history.length ? `Your last actions:\n${history.slice(-6).join('\n')}` : '';
  const messages: ChatMessage[] = [renderObservation(obs, preface)];
  let choice = await ctx.inference.chooseAction({ ...prompt, messages });
  let action = 'error' in choice ? null : parseAction(choice.toolName, choice.args);
  if (!action) {
    choice = await ctx.inference.chooseAction({ ...prompt, messages: [...messages, { role: 'user', content: RETRY_NUDGE }] });
    action = 'error' in choice ? null : parseAction(choice.toolName, choice.args);
  }
  const reasoning = 'error' in choice ? '' : choice.reasoning;
  if (action) return { action, reasoning };
  return { action: null, reasoning, error: 'error' in choice ? choice.error : 'bad-args' };
}

/** The element an action would trigger, when that is the final purchase (pointer AND keyboard paths); otherwise null. */
async function gatedTarget(ctx: AgentContext, action: Action): Promise<ElementIdentity | null> {
  const rpc = ctx.sandbox.rpc;
  let identity: ElementIdentity | null = null;
  if (action.type === 'click' || action.type === 'type' || action.type === 'select') {
    identity = await rpc.call({ m: 'describe', kind: ctx.kind, target: action.target }).catch(() => null);
  } else if (action.type === 'press' && (action.key === 'Enter' || action.key === 'Space')) {
    identity = await rpc.call({ m: 'describe', kind: ctx.kind, target: 'focused' }).catch(() => null);
  }
  return identity && modePolicy(ctx.mode).gatesOn(identity) ? identity : null;
}

/**
 * Screenshots return, a vision model verifies: control takes a clean screenshot inside the sandbox
 * and asks the vision model whether the page is consistent with the goal. Advisory only, and it
 * never throws: if the screenshot or the model fails, the person decides without it.
 */
async function visionCheck(ctx: AgentContext, identity: ElementIdentity): Promise<VisionCheck> {
  const shot = await ctx.sandbox.rpc.call({ m: 'screenshot' }).catch(() => null);
  if (!shot) return { verdict: 'unavailable', observed: 'No screenshot could be taken.', concerns: [] };
  const png = Buffer.from(shot.png, 'base64');
  const shotId = ctx.storeShot(png);
  if (!ctx.inference.verifyScreenshot) return { verdict: 'unavailable', observed: 'No vision model is configured.', concerns: [], shotId };
  try {
    const v = await ctx.inference.verifyScreenshot({ goal: ctx.goal, target: identity.snippet, png });
    return { verdict: v.matches ? 'consistent' : 'inconsistent', observed: v.observed, concerns: v.concerns, shotId };
  } catch {
    return { verdict: 'unavailable', observed: 'The vision model did not answer. Judge from the screenshot.', concerns: [], shotId };
  }
}

/** Reaching the final button ends the journey; the action itself runs only if a person approves it. */
async function passGate(ctx: AgentContext, identity: ElementIdentity, action: Action, milestones: MilestoneId[]): Promise<{ result: ActResult; milestones: MilestoneId[] }> {
  const rpc = ctx.sandbox.rpc;
  const probeBefore = await rpc.call({ m: 'probe' }).catch(() => null);
  let reached = longer(milestones, probeBefore ? ctx.milestonesOf(probeBefore, true) : []);
  const check = await visionCheck(ctx, identity);
  await ctx.checkpoint?.(); // a Stop during the check must not open an approval
  const decision = await ctx.gate(identity, check);
  let result: ActResult = { ok: false, error: `approval-${decision}`, element: identity };
  if (decision === 'approved') result = await rpc.call({ m: 'act', kind: ctx.kind, action });
  if (reached.length === 0) reached = ['awaiting_final_approval'];
  return { result: { ...result, element: result.element ?? identity }, milestones: reached };
}

/** Runs one action and probes the page afterwards. Focus moves record the newly focused element. */
async function actAndProbe(ctx: AgentContext, action: Action): Promise<{ result: ActResult; probe: Probe }> {
  const rpc = ctx.sandbox.rpc;
  let result = await rpc.call({ m: 'act', kind: ctx.kind, action });
  if (action.type === 'press' && FOCUS_KEYS.has(action.key) && result.ok && !result.element) {
    const focused = await rpc.call({ m: 'describe', kind: ctx.kind, target: 'focused' }).catch(() => null);
    if (focused) result = { ...result, element: focused };
  }
  return { result, probe: await rpc.call({ m: 'probe' }) };
}

const pageKey = (p: Probe) => `${p.url}|${p.domHash}`;

/**
 * One agent's journey: perceive → choose → (gate | act) → record, until it finishes, gets stuck,
 * makes no progress three times, or runs out of steps or time. Stop ends it with outcome `stopped`.
 */
export async function runAgent(ctx: AgentContext): Promise<AgentResult> {
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  const started = Date.now();
  const prompt = { system: systemPrompt(ctx.kind, ctx.goal), tools: toolsFor(ctx.kind) };
  const seen = ctx.seenInjectionTexts ?? new Set<string>();
  const steps: RecordedStep[] = [];
  const history: string[] = [];
  let milestones: MilestoneId[] = [];
  let lastKey: string | null = null;
  let stale = 0;
  let outcome: AgentOutcome = 'max-steps';

  const record = (s: RecordedStep) => {
    steps.push(s);
    history.push(`Step ${s.index + 1}: ${describeAction(s.action)} → ${s.result.ok ? 'ok' : `failed: ${s.result.error}`}`);
    ctx.emit({ t: 'step', runId: ctx.runId, agent: ctx.agent, index: s.index, url: s.url, reasoning: s.reasoning, action: s.action, result: s.result, shotId: s.shotId, axExcerpt: s.axExcerpt, milestones: s.milestonesAfter });
  };

  try {
    // baseline: a step makes progress only if it changes URL or page state
    const initial = await ctx.sandbox.rpc.call({ m: 'probe' }).catch(() => null);
    if (initial) {
      lastKey = pageKey(initial);
      milestones = ctx.milestonesOf(initial, false);
    }
    for (let index = 0; index < limits.maxSteps; index++) {
      await ctx.checkpoint?.();
      if (Date.now() - started >= limits.wallMs) { outcome = 'timeout'; break; }

      const { obs, shotId, axExcerpt, screening } = await perceive(ctx, seen);
      const choice = await choose(ctx, prompt, obs, history);
      await screening; // flags land on the timeline before the step they belong to
      const base = { index, axExcerpt, shotId, reasoning: choice.reasoning, url: obs.url };

      if (!choice.action) {
        const err = 'error' in choice ? choice.error : 'bad-args';
        record({ ...base, action: { type: 'stuck', reason: `model returned no usable tool call (${err})` }, result: { ok: false, error: `model-${err}` }, milestonesAfter: milestones });
        if (++stale >= limits.noProgress) { outcome = 'no-progress'; break; }
        continue;
      }
      const action = choice.action;

      if (action.type === 'done' || action.type === 'stuck') {
        record({ ...base, action, result: { ok: true }, milestonesAfter: milestones });
        outcome = action.type;
        break;
      }

      const identity = await gatedTarget(ctx, action);
      if (identity) {
        const gated = await passGate(ctx, identity, action, milestones);
        milestones = gated.milestones;
        record({ ...base, action, result: gated.result, milestonesAfter: milestones });
        outcome = 'gate';
        break;
      }

      const { result, probe } = await actAndProbe(ctx, action);
      milestones = longer(milestones, ctx.milestonesOf(probe, false));
      record({ ...base, action, result, milestonesAfter: milestones });

      const key = pageKey(probe);
      stale = key === lastKey ? stale + 1 : 0;
      lastKey = key;
      if (stale >= limits.noProgress) { outcome = 'no-progress'; break; }
    }
  } catch (e) {
    if (e instanceof StoppedError) return { outcome: 'stopped', steps, milestones };
    outcome = 'error';
    ctx.emit({ t: 'step', runId: ctx.runId, agent: ctx.agent, index: steps.length, url: '', reasoning: '', action: { type: 'stuck', reason: 'agent error' }, result: { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, milestones });
  }

  ctx.emit({ t: 'agent.finished', runId: ctx.runId, agent: ctx.agent, outcome, milestones });
  return { outcome, steps, milestones };
}
