import { expect, test, vi } from 'vitest';
import type { Finding, MilestoneId, Patch, RunEvent } from '@earshot/shared';
import { runFixLoop, type FixLoopContext } from '../src/fix/loop.js';
import type { AgentResult } from '../src/agents/loop.js';
import type { Inference } from '../src/inference/client.js';
import type { Attempts } from '../src/runs/attempts.js';

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
  const opened: Patch[][] = [];
  let r = 0;
  // the newest patch matches `patchMatches[rerun]` elements (default 1); stacked earlier patches match 1
  const agent = vi.fn<Attempts['agent']>(async (_agent, _kind, patches = []) => {
    const n = r++;
    opened.push(patches);
    const x = opts.reruns[Math.min(n, opts.reruns.length - 1)]!;
    const reports = Object.fromEntries(patches.map((p, i) => [p.findingId, { matches: i === patches.length - 1 ? (opts.patchMatches?.[n] ?? 1) : 1 }]));
    return { result: { outcome: x.outcome ?? 'no-progress', steps: [], milestones: x.milestones }, patches: reports };
  });
  let f = 0;
  const attribute = vi.fn<Attempts['attribute']>(async () => opts.nextFindings?.[f++] ?? null);
  let g = 0;
  const defaultPatch = (i: number) => ({ selector: `.fix${i}`, attributes: { role: 'button', tabindex: '0' }, keyboardShim: true });
  const inference = { json: vi.fn(async () => opts.patches?.[g] ?? defaultPatch(g++)), chooseAction: vi.fn(), speech: vi.fn() } as unknown as Inference;
  const events: RunEvent[] = [];
  const ctx: FixLoopContext = {
    runId: 'r1', sighted, firstFinding: finding('f1', 'grind_selected', '.grind-swatch'), inference,
    attempts: { agent, attribute }, emit: (e) => events.push(e),
  };
  return { ctx, opened, events, agent, attribute, inference };
}

test('two stacked fixes then gate → verified', async () => {
  const h = harness({
    reruns: [{ milestones: upTo('on_checkout') }, { milestones: M, outcome: 'gate' }],
    nextFindings: [finding('f2', 'details_entered', '.field')],
  });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(true);
  expect(r.patches.map((p) => p.findingId)).toEqual(['f1', 'f2']);
  expect(h.agent.mock.calls.map((c) => [c[0], c[1]])).toEqual([['rerun-1', 'blind'], ['rerun-2', 'blind']]);
  expect(h.opened[1]!.map((p) => p.findingId)).toEqual(['f1', 'f2']); // rerun 2 got both patches
  expect(r.findings.map((f) => f.status)).toEqual(['verified', 'verified']);
  const fixes = h.events.filter((e) => e.t === 'fix.result');
  expect(fixes).toHaveLength(2);
  expect(fixes.every((e) => (e as any).verified && (e as any).diff.includes('+'))).toBe(true);
  expect(h.attribute).toHaveBeenCalledOnce();
  expect(h.attribute.mock.calls[0]![2]!.map((p: Patch) => p.findingId)).toEqual(['f1']);
});

test('patch with 0 matches is retried once then finding unverified and loop stops', async () => {
  const h = harness({ reruns: [{ milestones: upTo('on_product_page') }], patchMatches: [0, 0] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect(h.agent).toHaveBeenCalledTimes(2);
  expect(r.findings[0]!.status).toBe('unverified');
  const second = (h.inference.json as any).mock.calls[1][0].user as string;
  expect(second).toContain('matched no elements');
  expect(h.events.filter((e) => e.t === 'fix.result').map((e) => (e as any).attempt)).toEqual([1, 2]);
});

test('invalid model patch counts as an attempt and never reaches a sandbox', async () => {
  const h = harness({ reruns: [{ milestones: M, outcome: 'gate' }], patches: [{ selector: 'script', attributes: {}, keyboardShim: false }, { selector: 'script', attributes: {}, keyboardShim: false }] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect(h.agent).not.toHaveBeenCalled();
});

test('max 4 iterations', async () => {
  let k = 2;
  const h = harness({
    reruns: [{ milestones: upTo('in_cart') }],
    nextFindings: Array.from({ length: 10 }, () => finding(`f${k++}`, 'grind_selected', '.again')),
  });
  // every rerun passes the current finding's milestone only if it's grind_selected → keep producing new findings
  const r = await runFixLoop(h.ctx);
  expect(h.agent).toHaveBeenCalledTimes(4);
  expect(r.verified).toBe(false);
});

test('unconfirmed new divergence stops with verified:false', async () => {
  const h = harness({ reruns: [{ milestones: upTo('on_checkout') }], nextFindings: [{ ...finding('f2', 'details_entered', '.x'), confirmed: false }] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect(h.agent).toHaveBeenCalledOnce();
});

test('a stopped rerun ends the loop without another patch or sandbox', async () => {
  const h = harness({ reruns: [{ milestones: upTo('on_product_page'), outcome: 'stopped' }] });
  const r = await runFixLoop(h.ctx);
  expect(r.verified).toBe(false);
  expect((h.inference.json as any).mock.calls).toHaveLength(1);
  expect(h.agent).toHaveBeenCalledOnce();
});

test('a stop before an iteration starts throws before any patch is generated', async () => {
  const { StoppedError } = await import('../src/runs/control.js');
  const h = harness({ reruns: [{ milestones: M, outcome: 'gate' }] });
  h.ctx.checkpoint = async () => { throw new StoppedError(); };
  await expect(runFixLoop(h.ctx)).rejects.toBeInstanceOf(StoppedError);
  expect(h.inference.json).not.toHaveBeenCalled();
  expect(h.agent).not.toHaveBeenCalled();
});

test('every finding status change is published as a finding event and nothing is mutated in place', async () => {
  const h = harness({ reruns: [{ milestones: M, outcome: 'gate' }] });
  const first = h.ctx.firstFinding;
  const r = await runFixLoop(h.ctx);
  expect(first.status).toBe('open');
  const statuses = h.events.filter((e) => e.t === 'finding').map((e) => (e as any).finding.status);
  expect(statuses).toEqual(['fixing', 'verified']);
  expect(r.findings[0]!.status).toBe('verified');
});

test('a rerun that fails fails the fix loop', async () => {
  const h = harness({ reruns: [{ milestones: [] }] });
  h.agent.mockRejectedValueOnce(new Error('boom'));
  await expect(runFixLoop(h.ctx)).rejects.toThrow('boom');
});
