import type { Action, ActResult, AgentId, AgentKind, AgentOutcome, AxNodeView, ElementIdentity, MilestoneId, Observation, Probe, RunEvent, RunMode } from '@earshot/shared';
import type { ChatMessage, Inference } from '../inference/client.js';
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
  gate: (identity: ElementIdentity) => Promise<GateDecision>;
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

export async function runAgent(ctx: AgentContext): Promise<AgentResult> {
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  const started = Date.now();
  const tools = toolsFor(ctx.kind);
  const system = systemPrompt(ctx.kind, ctx.goal);
  const seen = ctx.seenInjectionTexts ?? new Set<string>();
  const steps: RecordedStep[] = [];
  const history: string[] = [];
  let milestones: MilestoneId[] = [];
  let lastKey: string | null = null;
  let stale = 0;
  let outcome: AgentOutcome = 'max-steps';
  const rpc = ctx.sandbox.rpc;

  const record = (s: RecordedStep) => {
    steps.push(s);
    history.push(`Step ${s.index + 1}: ${describeAction(s.action)} → ${s.result.ok ? 'ok' : `failed: ${s.result.error}`}`);
    ctx.emit({ t: 'step', runId: ctx.runId, agent: ctx.agent, index: s.index, url: s.url, reasoning: s.reasoning, action: s.action, result: s.result, shotId: s.shotId, axExcerpt: s.axExcerpt, milestones: s.milestonesAfter });
  };

  try {
    // baseline: a step makes progress only if it changes URL or page state
    const initial = await rpc.call({ m: 'probe' }).catch(() => null);
    if (initial) {
      lastKey = `${initial.url}|${initial.domHash}`;
      milestones = ctx.milestonesOf(initial, false);
    }
    for (let index = 0; index < limits.maxSteps; index++) {
      await ctx.checkpoint?.();
      if (Date.now() - started >= limits.wallMs) { outcome = 'timeout'; break; }

      // 1. observe
      const obs = await rpc.call({ m: 'observe', kind: ctx.kind });
      let shotId: string | undefined;
      let axExcerpt: AxNodeView[] | undefined;
      // injection screening runs alongside the model's choice instead of before it (it used to eat the step budget)
      let screening: Promise<void> = Promise.resolve();
      if (obs.kind === 'sighted') shotId = ctx.storeShot(Buffer.from(obs.screenshotPng, 'base64'));
      else {
        axExcerpt = obs.nodes.slice(0, EXCERPT_MAX);
        screening = screenForInjection(ctx, obs.nodes, seen);
      }

      // 2. choose (one corrective retry)
      const preface = history.length ? `Your last actions:\n${history.slice(-6).join('\n')}` : '';
      const messages: ChatMessage[] = [renderObservation(obs, preface)];
      let choice = await ctx.inference.chooseAction({ system, messages, tools });
      let action = 'error' in choice ? null : parseAction(choice.toolName, choice.args);
      if (!action) {
        choice = await ctx.inference.chooseAction({ system, messages: [...messages, { role: 'user', content: RETRY_NUDGE }], tools });
        action = 'error' in choice ? null : parseAction(choice.toolName, choice.args);
      }
      await screening; // flags land on the timeline before the step they belong to
      const reasoning = 'error' in choice ? '' : choice.reasoning;
      if (!action) {
        const err = 'error' in choice ? choice.error : 'bad-args';
        record({ index, action: { type: 'stuck', reason: `model returned no usable tool call (${err})` }, result: { ok: false, error: `model-${err}` }, milestonesAfter: milestones, axExcerpt, shotId, reasoning, url: obs.url });
        if (++stale >= limits.noProgress) { outcome = 'no-progress'; break; }
        continue;
      }

      if (action.type === 'done' || action.type === 'stuck') {
        record({ index, action, result: { ok: true }, milestonesAfter: milestones, axExcerpt, shotId, reasoning, url: obs.url });
        outcome = action.type;
        break;
      }

      // 3. approval gate: pointer AND keyboard paths
      let identity: ElementIdentity | null = null;
      if (action.type === 'click' || action.type === 'type' || action.type === 'select') {
        identity = await rpc.call({ m: 'describe', kind: ctx.kind, target: action.target }).catch(() => null);
      } else if (action.type === 'press' && (action.key === 'Enter' || action.key === 'Space')) {
        identity = await rpc.call({ m: 'describe', kind: ctx.kind, target: 'focused' }).catch(() => null);
      }
      if (identity && (identity.isFinal || (ctx.mode === 'any-url' && identity.isFormSubmit))) {
        const probeBefore = await rpc.call({ m: 'probe' }).catch(() => null);
        milestones = longer(milestones, probeBefore ? ctx.milestonesOf(probeBefore, true) : []);
        const decision = await ctx.gate(identity);
        let result: ActResult = { ok: false, error: `approval-${decision}`, element: identity };
        if (decision === 'approved') result = await rpc.call({ m: 'act', kind: ctx.kind, action });
        if (milestones.length === 0) milestones = ['awaiting_final_approval'];
        record({ index, action, result: { ...result, element: result.element ?? identity }, milestonesAfter: milestones, axExcerpt, shotId, reasoning, url: obs.url });
        outcome = 'gate';
        break;
      }

      // 4. act, 5. probe, 6. emit
      let result = await rpc.call({ m: 'act', kind: ctx.kind, action });
      if (action.type === 'press' && FOCUS_KEYS.has(action.key) && result.ok && !result.element) {
        const focused = await rpc.call({ m: 'describe', kind: ctx.kind, target: 'focused' }).catch(() => null);
        if (focused) result = { ...result, element: focused };
      }
      const probe = await rpc.call({ m: 'probe' });
      milestones = longer(milestones, ctx.milestonesOf(probe, false));
      record({ index, action, result, milestonesAfter: milestones, axExcerpt, shotId, reasoning, url: obs.url });

      const key = `${probe.url}|${probe.domHash}`;
      if (key === lastKey) {
        if (++stale >= limits.noProgress) { outcome = 'no-progress'; break; }
      } else {
        stale = 0;
      }
      lastKey = key;
    }
  } catch (e) {
    if (e instanceof StoppedError) return { outcome: 'stopped', steps, milestones };
    outcome = 'error';
    ctx.emit({ t: 'step', runId: ctx.runId, agent: ctx.agent, index: steps.length, url: '', reasoning: '', action: { type: 'stuck', reason: 'agent error' }, result: { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, milestones });
  }

  ctx.emit({ t: 'agent.finished', runId: ctx.runId, agent: ctx.agent, outcome, milestones });
  return { outcome, steps, milestones };
}
