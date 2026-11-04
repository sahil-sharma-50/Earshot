import { useEffect, useState } from 'react';
import type { AgentId, MilestoneId } from '@earshot/shared';
import type { RunView } from '../reduce.js';

export type Selection =
  | { kind: 'overview' }
  | { kind: 'step'; agent: AgentId; index: number }
  | { kind: 'finding'; id: string }
  | { kind: 'event'; i: number }
  | { kind: 'status'; key: string; title: string };

export const latestStep = (view: RunView): { agent: AgentId; index: number } | null => view.lastStep ?? null;

/** First step of `agent` that reached checkpoint `id`; if it never did, its last step; null with no steps. */
export function stepAtCheckpoint(view: RunView, agent: AgentId, id: MilestoneId): number | null {
  const steps = view.agents[agent]?.steps ?? [];
  if (!steps.length) return null;
  if (view.meta?.mode === 'any-url' && id === 'on_product_page') return steps[0]!.index;
  return (steps.find((s) => s.milestones.includes(id)) ?? steps.at(-1)!).index;
}

export function nextSelection(prev: Selection, view: RunView, follow: boolean): Selection {
  if (follow && view.finished) {
    const f = view.findings.find((x) => x.confirmed);
    return f ? (prev.kind === 'finding' && prev.id === f.id ? prev : { kind: 'finding', id: f.id }) : prev.kind === 'overview' ? prev : { kind: 'overview' };
  }
  const l = latestStep(view);
  if (!follow || !l) return prev;
  return prev.kind === 'step' && prev.agent === l.agent && prev.index === l.index ? prev : { kind: 'step', ...l };
}

/** Detail-panel selection with follow-live: new steps are selected until the viewer picks something themselves. */
export function useSelection(view: RunView) {
  const [sel, setSel] = useState<Selection>({ kind: 'overview' });
  const [follow, setFollow] = useState(true);
  useEffect(() => { setSel((p) => nextSelection(p, view, follow)); }, [view.lastStep, view.finished, view.findings.length, follow]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    sel,
    follow,
    select: (s: Selection) => { setFollow(false); setSel(s); },
    setFollow,
  };
}
