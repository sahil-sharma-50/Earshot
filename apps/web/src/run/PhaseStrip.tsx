import { Check, Square } from 'lucide-react';
import { GLOSSARY, type PhaseStep } from '../narrative.js';
import { Toggletip } from '../ui/Toggletip.js';

const STATE_TEXT = { current: '(in progress)', done: '(done)', skipped: '(skipped)', upcoming: '(upcoming)', stopped: '(stopped here)' } as const;

export function PhaseStrip({ steps }: { steps: PhaseStep[] }) {
  return (
    <ol className="phases" aria-label="Run phases">
      {steps.map((p, i) => (
        <li key={p.key} className={`phase ${p.state}`} aria-current={p.state === 'current' ? 'step' : undefined}>
          <span className="phase-mark" aria-hidden>{p.state === 'done' ? <Check size={12} strokeWidth={3} /> : p.state === 'stopped' ? <Square size={10} fill='currentColor' /> : i + 1}</span>
          <span className="phase-label">{p.label}</span>
          {p.note && <span className="phase-note">{p.note}</span>}
          <span className="sr-only">{STATE_TEXT[p.state]}</span>
          <Toggletip label={`About ${p.label}`} align={i > 2 ? 'end' : 'start'}>{GLOSSARY[p.key]}</Toggletip>
        </li>
      ))}
    </ol>
  );
}
