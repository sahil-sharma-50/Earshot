import { DEMO_MILESTONES, type MilestoneId } from '@earshot/shared';
import { MILESTONE_LABEL } from '../labels.js';

/** Seven journey segments; filled up to the furthest milestone this agent reached. */
export function MilestoneBar({ reached, tone, compact = false }: { reached: MilestoneId[]; tone: 'sighted' | 'blind' | 'rerun'; compact?: boolean }) {
  const n = reached.length;
  return (
    <ol className={`milestones tone-${tone}${compact ? ' compact' : ''}`} aria-label={`Journey progress: ${n} of ${DEMO_MILESTONES.length} steps`}>
      {DEMO_MILESTONES.map((m, i) => (
        <li key={m} className={i < n ? 'hit' : ''} title={MILESTONE_LABEL[m]}>
          <span className="seg" />
          {!compact && <span className="seg-label">{MILESTONE_LABEL[m]}</span>}
        </li>
      ))}
    </ol>
  );
}
