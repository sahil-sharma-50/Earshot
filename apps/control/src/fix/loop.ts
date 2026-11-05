import { previewPatch, type AgentId, type Finding, type Patch, type RunEvent } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import type { AgentResult } from '../agents/loop.js';
import type { Attempts } from '../runs/attempts.js';
import { generatePatch } from './generate.js';
import { renderDiff } from './diff.js';

export const MAX_ITERATIONS = 4;
export const MAX_ATTEMPTS = 2;

export interface FixLoopContext {
  runId: string;
  sighted: AgentResult;
  firstFinding: Finding;
  inference: Inference;
  /** Reruns and attribution, each in its own leased sandbox. */
  attempts: Attempts;
  emit: (e: RunEvent) => void;
  /** Pause/stop gate, awaited before each iteration. */
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

  // every status change is an event: viewers, late subscribers and the run record all see the same finding
  const setStatus = (status: Finding['status']) => {
    current = { ...current, status };
    findings[findings.length - 1] = current;
    ctx.emit({ t: 'finding', finding: current });
  };
  const giveUp = () => {
    setStatus('unverified');
    return { verified: false, patches, findings };
  };

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    await ctx.checkpoint?.();
    attempt++;
    if (current.status !== 'fixing') setStatus('fixing');
    const gen = await generatePatch(ctx.inference, current, previous);
    if ('error' in gen) {
      previous = { failure: gen.error };
      if (attempt >= MAX_ATTEMPTS) return giveUp();
      continue;
    }

    const agent: AgentId = `rerun-${iteration}`;
    const stacked = [...patches, gen];
    const { result, patches: reports } = await ctx.attempts.agent(agent, 'blind', stacked);
    const report = reports[gen.findingId];
    // a Stop mid-rerun: no fix result, no further patch or sandbox
    if (result.outcome === 'stopped') return { verified: false, patches, findings };

    const matched = (report?.matches ?? 0) > 0;
    const passed = result.milestones.includes(current.milestone);
    const accepted = matched && passed;
    // the preview is built from what the page reported writing, so it shows what really happened
    const diff = renderDiff(current.element.snippet, previewPatch(current.element.snippet, gen, report?.applied));
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
    setStatus('verified');
    if (result.outcome === 'gate') return { verified: true, patches, findings };

    const next = await ctx.attempts.attribute(ctx.sighted, result, [...patches]);
    if (!next || !next.confirmed) return { verified: false, patches, findings: next ? [...findings, next] : findings };
    findings.push(next);
    current = next;
    attempt = 0;
    previous = undefined;
  }
  return { verified: false, patches, findings };
}
