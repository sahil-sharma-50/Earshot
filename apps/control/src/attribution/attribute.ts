import { randomBytes } from 'node:crypto';
import { modePolicy, type Action, type AxNodeView, type ElementReport, type Finding, type Patch, type RunEvent, type RunMode } from '@earshot/shared';
import type { AgentResult, RecordedStep } from '../agents/loop.js';
import type { LeaseSandbox } from '../sandbox/lease.js';
import { classify } from './classify.js';

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
  const div = modePolicy(ctx.mode).divergence(ctx.sighted, ctx.blind);
  if (!div) return null;
  const target = ctx.sighted.steps.find((s) => s.index === div.sightedStepIndex)!.result.element!;

  return ctx.lease({ runId: ctx.runId, agent: 'inspector', mode: ctx.mode, allowHosts: ctx.allowHosts }, async (inspector) => {
    await inspector.rpc.call({ m: 'open', url: ctx.startUrl, patches: ctx.patches }, 60_000);
    await inspector.rpc.call({ m: 'replay', actions: replayPlan(ctx.sighted.steps, div.sightedStepIndex) }, 120_000);
    // speech first: inspect presses Tab/Enter and may change the page
    const region = await inspector.rpc.call({ m: 'axSpeech', cssPath: parentPath(target.cssPath) }).catch(() => [] as AxNodeView[]);
    const report = await inspector.rpc.call({ m: 'inspect', cssPath: target.cssPath }, 120_000);
    const verdict = classify(report);
    const finding: Finding = {
      id: `f-${randomBytes(4).toString('hex')}`,
      runId: ctx.runId,
      milestone: div.checkpoint,
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
