import { Ban, Box, Hand, ShieldAlert, Trash2 } from 'lucide-react';
import type { RailEvent } from '../reduce.js';
import { describeEvent } from './events.js';
import type { Selection } from './selection.js';

const ICON = { 'sandbox.created': Box, 'sandbox.destroyed': Trash2, 'containment.blocked': Ban, 'injection.flagged': ShieldAlert, 'approval.requested': Hand, 'approval.resolved': Hand } as const;

export function SafetyLog({ events, sel, onSelect }: { events: RailEvent[]; sel: Selection; onSelect: (s: Selection) => void }) {
  if (events.length === 0) return <p className="empty">Sandbox lifecycle, blocked requests and approvals appear here as they happen.</p>;
  return (
    <ol className="safety-list">
      {events.map((e, i) => {
        const d = describeEvent(e);
        const Icon = ICON[e.t];
        const on = sel.kind === 'event' && sel.i === i;
        return (
          <li key={i}>
            <button type="button" className={`safety-row tone-${d.tone}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onSelect({ kind: 'event', i })}>
              <Icon size={16} aria-hidden />
              <span className="safety-title">{d.title}</span>
              <span className="safety-raw mono">{d.raw}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
