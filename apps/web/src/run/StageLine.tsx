import { Check, X } from 'lucide-react';
import type { PhaseKey, PhaseStep } from '../narrative.js';

/** Short past-tense labels once a stage is behind us, so the finished line reads as a record. */
const DONE_LABEL: Record<PhaseKey, string> = {
  queue: 'Got a slot',
  agents: 'Both agents tried',
  compare: 'Blocker checked',
  fix: 'Fix written',
  verify: 'Fix tested',
};

/** One short clause under the current stage: what it means right now. */
const NOW_HINT: Record<PhaseKey, string> = {
  queue: 'runs take turns on the Vultr server',
  agents: 'each in its own sealed sandbox',
  compare: 'a fresh sandbox re-checks the element',
  fix: 'attributes only, never new code',
  verify: 'a fresh blind agent tries again',
};

/** The run's five stages on one line. The current one says what it means; skipped ones say why. */
export function StageLine({ steps, aside }: { steps: PhaseStep[]; aside?: string }) {
  return (
    <nav className="stageline" aria-label="Run stages">
      <ol>
        {steps.map((s, i) => (
          <li key={s.key} className={`stage is-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="stage-mark" aria-hidden>
              {s.state === 'done' ? <Check size={12} strokeWidth={3} /> : s.state === 'stopped' ? <X size={12} strokeWidth={3} /> : i + 1}
            </span>
            <span className="stage-label">{s.state === 'done' ? DONE_LABEL[s.key] : s.label}</span>
            {s.state === 'current' && <span className="stage-hint">{NOW_HINT[s.key]}</span>}
            {(s.state === 'skipped' || s.state === 'stopped') && s.note && <span className="stage-hint">{s.note}</span>}
            <span className="sr-only">{s.state === 'current' ? ' (now)' : s.state === 'done' ? ' (done)' : s.state === 'upcoming' ? ' (next)' : ''}</span>
          </li>
        ))}
      </ol>
      {aside && <p className="stageline-aside">{aside}</p>}
    </nav>
  );
}
