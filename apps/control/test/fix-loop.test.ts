import { expect, test, vi } from 'vitest';
import type { Finding, MilestoneId, Patch, RpcCall, RunEvent } from '@earshot/shared';
import { runFixLoop, type FixLoopContext } from '../src/fix/loop.js';
import type { AgentResult } from '../src/agents/loop.js';
import type { Sandbox, SandboxOpts } from '../src/sandbox/docker.js';
import type { Inference } from '../src/inference/client.js';

const M: MilestoneId[] = ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered', 'on_review', 'awaiting_final_approval'];
const upTo = (m: MilestoneId) => M.slice(0, M.indexOf(m) + 1);
const finding = (id: string, milestone: MilestoneId, cssPath: string): Finding => ({
  id, runId: 'r1', milestone, element: { cssPath, backendNodeId: 1, snippet: `<div class="${cssPath.slice(1)}">x</div>`, isFinal: false, isFormSubmit: false },
  categories: ['wrong-role'], axeRules: [], wcag: ['4.1.2'], confirmed: true, evidence: { sightedStep: 1, blindLastStep: 1, blindExcerpt: [] }, status: 'open',
});
const sighted: AgentResult = { outcome: 'gate', steps: [], milestones: M };

function harness(opts: {
  reruns: { milestones: MilestoneId[]; outcome?: AgentResult['outcome'] }[];
  patchMatches?: number[];
  nextFindings?: (Finding | null)[];
  patches?: unknown[];
}) {
  const created: SandboxOpts[] = [];
  const opened: Patch[][] = [];
  const destroyed: string[] = [];
  let sbN = 0;
  const createSandbox = vi.fn(async (o: SandboxOpts) => {
    created.push(o);
    const n = sbN++;
    return {
      id: `c${n}`, ip: '', agent: o.agent, destroyed: false, limits: {} as never,
      rpc: {
        call: async (req: RpcCall) => {
          if (req.m === 'open') opened.push((req as any).patches);
          if (req.m === 'patchStatus') { const p = opened.at(-1)!.at(-1)!; return { [p.findingId]: opts.patchMatches?.[n] ?? 1, ...Object.fromEntries(opened.at(-1)!.slice(0, -1).map((x) => [x.findingId, 1])) }; }
          return {};
        },
      },
      destroy: async (r: string) => { destroyed.push(`c${n}:${r}`); },
    } as unknown as Sandbox;
  });
  let r = 0;
  const runAgentFn = vi.fn(async () => {
    const x = opts.reruns[Math.min(r++, opts.reruns.length - 1)]!;
    return { outcome: x.outcome ?? 'no-progress', steps: [], milestones: x.milestones } as AgentResult;
  });
  let f = 0;
  const attributeFn = vi.fn(async () => opts.nextFindings?.[f++] ?? null);
  let g = 0;
  const defaultPatch = (i: number) => ({ selector: `.fix${i}`, attributes: { role: 'button', tabindex: '0' }, keyboardShim: true });
  const inference = { json: vi.fn(async () => opts.patches?.[g] ?? defaultPatch(g++)), chooseAction: vi.fn(), speech: vi.fn() } as unknown as Inference;
  const events: RunEvent[] = [];
  const ctx: FixLoopContext = {
    runId: 'r1', goal: 'g', mode: 'demo', startUrl: 'http://store:8080/', allowHosts: ['store:8080'], sighted,
    firstFinding: finding('f1', 'grind_selected', '.grind-swatch'), inference, createSandbox, runAgentFn, attributeFn,
    emit: (e) => events.push(e), gate: async () => 'denied', storeShot: () => 's', seenInjectionTexts: new Set(),
  };
  return { ctx, created, opened, destroyed, events, runAgentFn, attributeFn, inference, createSandbox };
}

test('two stacked fixes then gate → verified', async () => {
  const h = harness({
    reruns: [{ milestones: upTo('on_checkout') }, { milestones: M, outcome: 'gate' }],
    nextFindings: [finding('f2', 'details_entered', '.field')],
  });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(true);
  expect(r.patches.map((p) => p.findingId)).toEqual(['f1', 'f2']);
  expect(h.created.map((c) => c.agent)).toEqual(['rerun-1', 'rerun-2']);
  expect(h.opened[1]!.map((p) => p.findingId)).toEqual(['f1', 'f2']); // rerun 2 got both patches
  expect(r.findings.map((f) => f.status)).toEqual(['verified', 'verified']);
  const fixes = h.events.filter((e) => e.t === 'fix.result');
  expect(fixes).toHaveLength(2);
  expect(fixes.every((e) => (e as any).verified && (e as any).diff.includes('+'))).toBe(true);
  expect(h.destroyed).toEqual(['c0:finished', 'c1:finished']);
  expect(h.attributeFn).toHaveBeenCalledOnce();
  expect((h.attributeFn.mock.calls[0] as any)[0].patches.map((p: Patch) => p.findingId)).toEqual(['f1']);
});

test('patch with 0 matches is retried once then finding unverified and loop stops', async () => {
  const h = harness({ reruns: [{ milestones: upTo('on_product_page') }], patchMatches: [0, 0] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect(h.runAgentFn).toHaveBeenCalledTimes(2);
  expect(r.findings[0]!.status).toBe('unverified');
  const second = (h.inference.json as any).mock.calls[1][0].user as string;
  expect(second).toContain('matched no elements');
  expect(h.events.filter((e) => e.t === 'fix.result').map((e) => (e as any).attempt)).toEqual([1, 2]);
});

test('invalid model patch counts as an attempt and never reaches a sandbox', async () => {
  const h = harness({ reruns: [{ milestones: M, outcome: 'gate' }], patches: [{ selector: 'script', attributes: {}, keyboardShim: false }, { selector: 'script', attributes: {}, keyboardShim: false }] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect(h.createSandbox).not.toHaveBeenCalled();
});

test('max 4 iterations', async () => {
  let k = 2;
  const h = harness({
    reruns: [{ milestones: upTo('in_cart') }],
    nextFindings: Array.from({ length: 10 }, () => finding(`f${k++}`, 'grind_selected', '.again')),
  });
  // every rerun passes the current finding's milestone only if it's grind_selected → keep producing new findings
  const r = await runFixLoop(h.ctx);
  expect(h.runAgentFn).toHaveBeenCalledTimes(4);
  expect(r.verified).toBe(false);
});

test('unconfirmed new divergence stops with verified:false', async () => {
  const h = harness({ reruns: [{ milestones: upTo('on_checkout') }], nextFindings: [{ ...finding('f2', 'details_entered', '.x'), confirmed: false }] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect(h.runAgentFn).toHaveBeenCalledOnce();
});

test('a rerun that throws still destroys its sandbox', async () => {
  const h = harness({ reruns: [{ milestones: [] }] });
  h.runAgentFn.mockRejectedValueOnce(new Error('boom'));
  await expect(runFixLoop(h.ctx)).rejects.toThrow('boom');
  expect(h.destroyed).toEqual(['c0:error']);
});
