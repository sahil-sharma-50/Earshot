import { evaluateMilestones, type AgentId, type AgentKind, type ElementIdentity, type Finding, type Patch, type PatchReport, type RunEvent, type RunMode, type VisionCheck } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import { runAgent, type AgentResult, type GateDecision } from '../agents/loop.js';
import { attribute } from '../attribution/attribute.js';
import { destroyReasonOf, type LeaseSandbox } from '../sandbox/lease.js';

/** What every attempt in a run shares (a RunRecord fits). */
export interface RunScope { id: string; mode: RunMode; goal: string; startUrl: string; allowHosts: string[]; seenInjectionTexts: Set<string> }

export interface AttemptDeps {
  lease: LeaseSandbox;
  inference: Inference;
  emit: (e: RunEvent) => void;
  storeShot: (png: Buffer) => string;
  gate: (agent: AgentId, identity: ElementIdentity, check: VisionCheck) => Promise<GateDecision>;
  /** Pause/stop gate, awaited before every agent step. */
  checkpoint?: () => Promise<void>;
  runAgentFn?: typeof runAgent;
  attributeFn?: typeof attribute;
}

/** One agent's journey, plus what each patch did on its pages (empty without patches). */
export interface Attempt { result: AgentResult; patches: Record<string, PatchReport> }

export interface Attempts {
  /** One agent in its own fresh sandbox, starting from the run's start page with `patches` applied. */
  agent(agent: AgentId, kind: AgentKind, patches?: Patch[]): Promise<Attempt>;
  /** Where `blind` fell short of `sighted`, inspected in a fresh inspector sandbox with `patches` applied. */
  attribute(sighted: AgentResult, blind: AgentResult, patches?: Patch[]): Promise<Finding | null>;
}

/**
 * The run-scoped agent attempt: everything a stage needs to put an agent or the inspector in a
 * sandbox, bound once per run. Each sandbox is leased and destroyed however its job ends.
 */
export function attemptsFor(run: RunScope, d: AttemptDeps): Attempts {
  const runAgentFn = d.runAgentFn ?? runAgent;
  const attributeFn = d.attributeFn ?? attribute;
  return {
    agent: (agent, kind, patches = []) =>
      d.lease({ runId: run.id, agent, mode: run.mode, allowHosts: run.allowHosts }, async (sandbox) => {
        await sandbox.rpc.call({ m: 'open', url: run.startUrl, patches }, 60_000);
        const result = await runAgentFn({
          runId: run.id, agent, kind, mode: run.mode, goal: run.goal, sandbox, inference: d.inference,
          emit: d.emit, storeShot: d.storeShot, seenInjectionTexts: run.seenInjectionTexts,
          gate: (identity, check) => d.gate(agent, identity, check), milestonesOf: evaluateMilestones, checkpoint: d.checkpoint,
        });
        // a report that can't be read counts as no matches: the fix is then not accepted
        const reports = patches.length ? await sandbox.rpc.call({ m: 'patchStatus' }).catch(() => ({})) : {};
        return { result, patches: reports };
      }, (a) => destroyReasonOf(a.result.outcome)),
    attribute: (sighted, blind, patches = []) =>
      attributeFn({
        runId: run.id, mode: run.mode, sighted, blind, startUrl: run.startUrl, allowHosts: run.allowHosts,
        patches, lease: d.lease, emit: d.emit,
      }),
  };
}
