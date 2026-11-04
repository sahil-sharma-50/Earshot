import { evaluateMilestones, type AgentId, type Finding, type Patch, type RunEvent, type RunMode } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import type { CreateSandbox } from '../sandbox/docker.js';
import type { AgentContext, AgentResult, GateDecision } from '../agents/loop.js';
import { runAgent } from '../agents/loop.js';
import type { ElementIdentity } from '@earshot/shared';
import { attribute } from '../attribution/attribute.js';
import { generatePatch } from './generate.js';
import { applyPatchToSnippet, renderDiff } from './diff.js';

export const MAX_ITERATIONS = 4;
export const MAX_ATTEMPTS = 2;

export interface FixLoopContext {
  runId: string;
  goal: string;
  mode: RunMode;
  startUrl: string;
  allowHosts: string[];
  sighted: AgentResult;
  firstFinding: Finding;
  inference: Inference;
  createSandbox: CreateSandbox;
  runAgentFn: typeof runAgent;
  attributeFn: typeof attribute;
  emit: (e: RunEvent) => void;
  gate: (agent: AgentId, identity: ElementIdentity) => Promise<GateDecision>;
  storeShot: (png: Buffer) => string;
  seenInjectionTexts: Set<string>;
  checkpoint?: () => Promise<void>;
}

/**
 * Spec §5.4: generate a patch for the newest finding, rerun the BLIND agent from the start in
 * a fresh sandbox with every accepted patch stacked, and continue until the gate (verified),
 * a finding that stays broken after 2 attempts, an inconclusive divergence, or 4 iterations.
 */
export async function runFixLoop(ctx: FixLoopContext): Promise<{ verified: boolean; patches: Patch[]; findings: Finding[] }> {
  const patches: Patch[] = [];
  const findings: Finding[] = [ctx.firstFinding];
  let current = ctx.firstFinding;
  let attempt = 0;
  let previous: { patch?: Patch; failure: string } | undefined;

  const giveUp = () => {
    current.status = 'unverified';
    return { verified: false, patches, findings };
  };

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    await ctx.checkpoint?.();
    attempt++;
    current.status = 'fixing';
    const gen = await generatePatch(ctx.inference, current, previous);
    if ('error' in gen) {
      previous = { failure: gen.error };
      if (attempt >= MAX_ATTEMPTS) return giveUp();
      continue;
    }

    const agent: AgentId = `rerun-${iteration}`;
    const stacked = [...patches, gen];
    const sb = await ctx.createSandbox({ runId: ctx.runId, agent, mode: ctx.mode, allowHosts: ctx.allowHosts });
    let result: AgentResult;
    let matches: Record<string, number> = {};
    let reason: 'finished' | 'error' = 'error';
    try {
      await sb.rpc.call({ m: 'open', url: ctx.startUrl, patches: stacked }, 60_000);
      const agentCtx: AgentContext = {
        runId: ctx.runId, agent, kind: 'blind', mode: ctx.mode, goal: ctx.goal, sandbox: sb, inference: ctx.inference,
        emit: ctx.emit, storeShot: ctx.storeShot, seenInjectionTexts: ctx.seenInjectionTexts,
        gate: (identity) => ctx.gate(agent, identity), milestonesOf: evaluateMilestones, checkpoint: ctx.checkpoint,
      };
      result = await ctx.runAgentFn(agentCtx);
      matches = await sb.rpc.call<Record<string, number>>({ m: 'patchStatus' }).catch(() => ({}));
      reason = 'finished';
    } finally {
      await sb.destroy(reason);
    }
    // a Stop mid-rerun: no fix result, no further patch or sandbox
    if (result.outcome === 'stopped') return { verified: false, patches, findings };

    const matched = (matches[gen.findingId] ?? 0) > 0;
    const passed = result.milestones.includes(current.milestone as never);
    const accepted = matched && passed;
    const diff = renderDiff(current.element.snippet, applyPatchToSnippet(current.element.snippet, gen));
    ctx.emit({ t: 'fix.result', runId: ctx.runId, findingId: current.id, attempt, patch: gen, diff, verified: accepted });

    if (!accepted) {
      previous = {
        patch: gen,
        failure: !matched ? `selector ${JSON.stringify(gen.selector)} matched no elements on the page` : `with the patch, the screen-reader agent still did not reach "${current.milestone}"`,
      };
      if (attempt >= MAX_ATTEMPTS) return giveUp();
      continue;
    }

    patches.push(gen);
    current.status = 'verified';
    if (result.outcome === 'gate') return { verified: true, patches, findings };

    const next = await ctx.attributeFn({
      runId: ctx.runId, mode: ctx.mode, sighted: ctx.sighted, blind: result, startUrl: ctx.startUrl,
      allowHosts: ctx.allowHosts, patches: [...patches], createSandbox: ctx.createSandbox, emit: ctx.emit,
    });
    if (!next || !next.confirmed) return { verified: false, patches, findings: next ? [...findings, next] : findings };
    findings.push(next);
    current = next;
    attempt = 0;
    previous = undefined;
  }
  return { verified: false, patches, findings };
}
