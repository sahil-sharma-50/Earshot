import type { RunView } from '../reduce.js';
import { workState } from './work.js';

const DECISION = { approved: 'Approved by a person', denied: 'Denied by a person', timeout: 'No answer, denied' } as const;

/** The containment record of a finished run, in six plain facts. */
export function SafetySummary({ view, onLog }: { view: RunView; onLog: () => void }) {
  const w = workState(view);
  const deleted = w.sandboxes.filter((s) => s.ended).length;
  return (
    <section className="card safety-card" aria-labelledby="safety-sum">
      <h2 id="safety-sum" className="card-title">Safety summary</h2>
      <dl className="safe-list">
        <div><dt>Sandboxes</dt><dd>{w.started} started · {deleted === w.sandboxes.length ? 'all deleted' : `${deleted} deleted`}</dd></div>
        <div><dt>Keys inside sandboxes</dt><dd className="is-ok">None</dd></div>
        <div><dt>Blocked requests</dt><dd className={w.blocked ? 'is-bad' : ''}>{w.blocked === 0 ? 'None needed' : `${w.blocked}${w.lastBlocked?.host === '169.254.169.254' ? ' · cloud metadata' : ''}`}</dd></div>
        <div><dt>Hidden instructions</dt><dd>{w.flagged ? `${w.flagged} spotted and flagged` : 'None seen'}</dd></div>
        <div><dt>Final click</dt><dd>{w.decision ? DECISION[w.decision] : w.asked ? 'Waiting for a person' : 'Never reached'}</dd></div>
        <div><dt>AI model</dt><dd>Vultr Serverless Inference</dd></div>
      </dl>
      <button type="button" className="btn small" onClick={onLog}>Open the full safety log</button>
    </section>
  );
}
