import { useState } from 'react';
import { Eye, Hand, Loader2, TriangleAlert } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { decide, shotUrl } from '../api.js';
import { visionSummary } from '../run/events.js';
import { agentName } from '../labels.js';
import { elementName } from '../narrative.js';
import { Dialog } from '../ui/Dialog.js';
import { formatLeft } from '../ui/clock.js';

const WINDOW_MS = 60_000;

/** Starter-only decision on the final purchase. Closing it leaves the decision pending (the Now banner reopens it). */
export function ApprovalModal({ runId, approval, open, onClose, now }: {
  runId: string; approval: NonNullable<RunView['approval']>; open: boolean; onClose: () => void; now: number;
}) {
  const [busy, setBusy] = useState<null | 'approved' | 'denied'>(null);
  const [error, setError] = useState<string | null>(null);
  const leftMs = approval.requestedAt + WINDOW_MS - now;

  async function answer(d: 'approved' | 'denied') {
    setBusy(d);
    setError(null);
    try {
      await decide(runId, approval.approvalId, d);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const who = agentName(approval.agent).toLowerCase();
  return (
    <Dialog
      open={open}
      title="Approve this purchase?"
      icon={<Hand size={22} aria-hidden />}
      onClose={onClose}
      actions={<>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void answer('denied')} autoFocus>
          {busy === 'denied' && <Loader2 className="spin" size={16} aria-hidden />} Deny
        </button>
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => void answer('approved')}>
          {busy === 'approved' && <Loader2 className="spin" size={16} aria-hidden />} Approve · {formatLeft(leftMs)}
        </button>
      </>}
    >
      {approval.check && <VisionCheckBox runId={runId} check={approval.check} />}
      <dl className="facts approval-facts">
        <div><dt>What’s requested</dt><dd>The {who} agent wants to press {elementName(approval.element.snippet)}.<details><summary>HTML</summary><pre className="code">{approval.element.snippet}</pre></details></dd></div>
        <div><dt>Why you’re asked</dt><dd>Purchases always need a human. Agents can never place an order on their own.</dd></div>
        <div><dt>If you approve</dt><dd>A demo order is placed in the demo store. Nothing is charged.</dd></div>
        <div><dt>If you deny or don’t answer</dt><dd>No order is placed; after 60 s it is denied automatically. Reaching this button already counts as completing the journey.</dd></div>
      </dl>
      <div className="countdown" aria-hidden><span style={{ width: `${Math.max(0, Math.min(1, leftMs / WINDOW_MS)) * 100}%` }} /></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </Dialog>
  );
}

/** What the vision model saw on a clean screenshot before you were asked. Advisory: you decide. */
function VisionCheckBox({ runId, check }: { runId: string; check: NonNullable<NonNullable<RunView['approval']>['check']> }) {
  const v = visionSummary(check);
  const Icon = v.tone === 'warn' ? TriangleAlert : Eye;
  return (
    <section className={`vision-check tone-${v.tone}`} aria-label="Vision check">
      <div className="vision-text">
        <p className="vision-head"><Icon size={16} aria-hidden /> <span>Vision check: <strong>{v.label}</strong></span></p>
        <p className="vision-observed">{check.observed}</p>
        {check.concerns.length > 0 && <ul className="vision-concerns">{check.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        <p className="vision-note">A vision model compared this screenshot with the goal. It advises; only you approve.</p>
      </div>
      {check.shotId && (
        <a className="vision-shot" href={shotUrl(runId, check.shotId)} target="_blank" rel="noreferrer">
          <img src={shotUrl(runId, check.shotId)} alt="Screenshot of the page the agent wants to finish on" />
          <span className="sr-only"> (opens full size in a new tab)</span>
        </a>
      )}
    </section>
  );
}
