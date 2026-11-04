import { randomBytes } from 'node:crypto';
import { DEMO_MILESTONES, type Action, type AxNodeView, type ElementReport, type Finding, type Patch, type RunEvent, type RunMode } from '@earshot/shared';
import type { AgentResult, RecordedStep } from '../agents/loop.js';
import type { LeaseSandbox } from '../sandbox/lease.js';
import { classify } from './classify.js';

export interface Divergence { milestone: string; sightedStepIndex: number }

export function findDivergence(sighted: AgentResult, blind: AgentResult, mode: RunMode): Divergence | null {
  if (mode === 'any-url') {
    if (blind.outcome === 'gate' || blind.outcome === 'done') return null;
    const blindPaths = new Set(blind.steps.map((s) => s.result.element?.cssPath).filter(Boolean));
    const step = sighted.steps.find((s) => s.result.ok && s.result.element && !blindPaths.has(s.result.element.cssPath));
    return step ? { milestone: step.result.element!.cssPath, sightedStepIndex: step.index } : null;
  }
  const milestone = DEMO_MILESTONES.find((m) => sighted.milestones.includes(m) && !blind.milestones.includes(m));
  if (!milestone) return null;
  const pos = sighted.steps.findIndex((s) => s.milestonesAfter.includes(milestone));
  if (pos < 0) return null;
  // the element that passed the milestone: this step's, or the nearest earlier element action.
  // The final purchase button never explains an earlier milestone (its probe merely observed it late).
  for (let i = pos; i >= 0; i--) {
    const el = sighted.steps[i]!.result.element;
    if (!el) continue;
    if (el.isFinal && milestone !== 'awaiting_final_approval') continue;
    return { milestone, sightedStepIndex: sighted.steps[i]!.index };
  }
  return null;
}

/** Successful sighted steps before `upTo`, as replayable {cssPath, action} pairs. */
export function replayPlan(steps: RecordedStep[], upTo: number): { cssPath: string; action: Action }[] {
  return steps
    .filter((s) => s.index < upTo && s.result.ok && s.action.type !== 'done' && s.action.type !== 'stuck')
    .map((s) => ({ cssPath: s.result.element?.cssPath ?? '', action: s.action }));
}

export function parentPath(cssPath: string): string {
  const i = cssPath.lastIndexOf(' > ');
  return i > 0 ? cssPath.slice(0, i) : cssPath;
}

export interface AttributeContext {
  runId: string;
  mode: RunMode;
  sighted: AgentResult;
  blind: AgentResult;
  startUrl: string;
  allowHosts: string[];
  patches: Patch[];
  lease: LeaseSandbox;
  emit: (e: RunEvent) => void;
}

/**
 * Re-creates the page state the sighted agent saw right before the divergent action in a
 * fresh inspector sandbox, then runs the deterministic checks on that element.
 */
export async function attribute(ctx: AttributeContext): Promise<Finding | null> {
  const div = findDivergence(ctx.sighted, ctx.blind, ctx.mode);
  if (!div) return null;
  const target = ctx.sighted.steps.find((s) => s.index === div.sightedStepIndex)!.result.element!;

  return ctx.lease({ runId: ctx.runId, agent: 'inspector', mode: ctx.mode, allowHosts: ctx.allowHosts }, async (inspector) => {
    await inspector.rpc.call({ m: 'open', url: ctx.startUrl, patches: ctx.patches }, 60_000);
    await inspector.rpc.call({ m: 'replay', actions: replayPlan(ctx.sighted.steps, div.sightedStepIndex) }, 120_000);
    // speech first: inspect presses Tab/Enter and may change the page
    const region = await inspector.rpc.call<AxNodeView[]>({ m: 'axSpeech', cssPath: parentPath(target.cssPath) }).catch(() => [] as AxNodeView[]);
    const report = await inspector.rpc.call<ElementReport>({ m: 'inspect', cssPath: target.cssPath }, 120_000);
    const verdict = classify(report);
    const finding: Finding = {
      id: `f-${randomBytes(4).toString('hex')}`,
      runId: ctx.runId,
      milestone: div.milestone,
      element: { ...report.identity, isFinal: target.isFinal, isFormSubmit: target.isFormSubmit },
      categories: verdict.categories,
      axeRules: verdict.axeRules,
      wcag: verdict.wcag,
      confirmed: verdict.categories.length > 0,
      evidence: { sightedStep: div.sightedStepIndex, blindLastStep: ctx.blind.steps.length - 1, blindExcerpt: region },
      status: 'open',
    };
    ctx.emit({ t: 'finding', finding });
    return finding;
  });
}
