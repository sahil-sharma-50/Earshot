import type { Action, ActResult, AgentId, AgentKind, AgentOutcome, AxNodeView, ElementIdentity, MilestoneId, Observation, Probe, RunEvent, RunMode } from '@earshot/shared';
import type { ChatMessage, Inference } from '../inference/client.js';
import type { Sandbox } from '../sandbox/docker.js';
import { describeAction, parseAction, toolsFor } from './tools.js';
import { renderObservation, systemPrompt } from './prompts.js';

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
}

export interface RecordedStep { index: number; action: Action; result: ActResult; milestonesAfter: MilestoneId[]; axExcerpt?: AxNodeView[]; shotId?: string; reasoning: string; url: string }
export interface AgentResult { outcome: AgentOutcome; steps: RecordedStep[]; milestones: MilestoneId[] }

const RETRY_NUDGE = 'You must call exactly one tool. Reply with a single tool call.';
const INJECTION_MIN_LEN = 80;
const EXCERPT_MAX = 80;

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
    const initial = await rpc.call<Probe>({ m: 'probe' }).catch(() => null);
    if (initial) {
      lastKey = `${initial.url}|${initial.domHash}`;
      milestones = ctx.milestonesOf(initial, false);
    }
    for (let index = 0; index < limits.maxSteps; index++) {
      if (Date.now() - started >= limits.wallMs) { outcome = 'timeout'; break; }

      // 1. observe
      const obs = await rpc.call<Observation>({ m: 'observe', kind: ctx.kind });
      let shotId: string | undefined;
      let axExcerpt: AxNodeView[] | undefined;
      if (obs.kind === 'sighted') shotId = ctx.storeShot(Buffer.from(obs.screenshotPng, 'base64'));
      else {
        axExcerpt = obs.nodes.slice(0, EXCERPT_MAX);
        if (ctx.inference.flagInjection) {
          for (const n of obs.nodes) {
            if (n.name.length > INJECTION_MIN_LEN && !seen.has(n.name)) {
              seen.add(n.name);
              const flagged = await ctx.inference.flagInjection(n.name).catch(() => false);
              if (flagged) ctx.emit({ t: 'injection.flagged', runId: ctx.runId, agent: ctx.agent, text: n.name });
            }
          }
        }
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
        identity = await rpc.call<ElementIdentity>({ m: 'describe', kind: ctx.kind, target: action.target }).catch(() => null);
      } else if (action.type === 'press' && (action.key === 'Enter' || action.key === 'Space')) {
        identity = await rpc.call<ElementIdentity>({ m: 'describe', kind: ctx.kind, target: 'focused' }).catch(() => null);
      }
      if (identity && (identity.isFinal || (ctx.mode === 'any-url' && identity.isFormSubmit))) {
        const probeBefore = await rpc.call<Probe>({ m: 'probe' }).catch(() => null);
        milestones = longer(milestones, probeBefore ? ctx.milestonesOf(probeBefore, true) : []);
        const decision = await ctx.gate(identity);
        let result: ActResult = { ok: false, error: `approval-${decision}`, element: identity };
        if (decision === 'approved') result = await rpc.call<ActResult>({ m: 'act', kind: ctx.kind, action });
        if (milestones.length === 0) milestones = ['awaiting_final_approval'];
        record({ index, action, result: { ...result, element: result.element ?? identity }, milestonesAfter: milestones, axExcerpt, shotId, reasoning, url: obs.url });
        outcome = 'gate';
        break;
      }

      // 4. act, 5. probe, 6. emit
      const result = await rpc.call<ActResult>({ m: 'act', kind: ctx.kind, action });
      const probe = await rpc.call<Probe>({ m: 'probe' });
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
    outcome = 'error';
    ctx.emit({ t: 'step', runId: ctx.runId, agent: ctx.agent, index: steps.length, url: '', reasoning: '', action: { type: 'stuck', reason: 'agent error' }, result: { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, milestones });
  }

  ctx.emit({ t: 'agent.finished', runId: ctx.runId, agent: ctx.agent, outcome, milestones });
  return { outcome, steps, milestones };
}
