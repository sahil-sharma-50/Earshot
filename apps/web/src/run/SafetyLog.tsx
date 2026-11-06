import { Ban, Box, ChevronRight, Hand, ShieldAlert, Trash2 } from 'lucide-react';
import type { RunMode } from '@earshot/shared';
import type { RailEvent } from '../reduce.js';
import { describeEvent } from './events.js';
import type { Selection } from './selection.js';

const ICON = { 'sandbox.created': Box, 'sandbox.destroyed': Trash2, 'containment.blocked': Ban, 'injection.flagged': ShieldAlert, 'approval.requested': Hand, 'approval.resolved': Hand } as const;

export function SafetyLog({ events, mode, sel, onSelect }: { events: RailEvent[]; mode?: RunMode; sel: Selection; onSelect: (s: Selection) => void }) {
  if (events.length === 0) return <p className="empty">Every sandbox start and delete, every blocked request and every approval shows up here as it happens.</p>;
  return (
    <ol className="safety-list">
      {events.map((e, i) => {
        const d = describeEvent(e, mode);
        const Icon = ICON[e.t];
        const on = sel.kind === 'event' && sel.i === i;
        return (
          <li key={i}>
            <button type="button" className={`safety-row tone-${d.tone}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onSelect({ kind: 'event', i })}>
              <Icon size={16} aria-hidden />
              <span className="safety-title">{d.title}</span>
              <ChevronRight size={14} aria-hidden className="safety-go" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
