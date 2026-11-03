import { useEffect, useRef, useState } from 'react';
import { Hand, Pause } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { decide } from '../api.js';
import { agentName } from '../labels.js';

const WINDOW_MS = 60_000;

/** Starter-only decision on the final purchase. Everyone else sees a read-only banner. */
export function ApprovalModal({ runId, approval, canDecide }: { runId: string; approval: NonNullable<RunView['approval']>; canDecide: boolean }) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (canDecide && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [canDecide, approval.approvalId]);
  const left = Math.max(0, Math.ceil((approval.requestedAt + WINDOW_MS - now) / 1000));

  if (!canDecide) {
    return (
      <div className="approval-banner" role="status">
        <Pause size={18} aria-hidden /> {agentName(approval.agent)} agent is waiting at Place order for the run’s starter to approve · {left}s
      </div>
    );
  }

  async function answer(d: 'approved' | 'denied') {
    setBusy(true);
    setError(null);
    try {
      await decide(runId, approval.approvalId, d);
      dialog.current?.close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="approval" aria-labelledby="approval-title" onCancel={(e) => e.preventDefault()}>
      <h2 id="approval-title"><Hand size={22} aria-hidden /> Approve this purchase?</h2>
      <p>The <strong>{agentName(approval.agent)}</strong> agent wants to press:</p>
      <pre className="snippet mono">{approval.element.snippet}</pre>
      <p className="small">Reaching this button already counts as completing the journey. Approving places a demo order; nothing is charged. With no answer in 60 seconds, the purchase is denied.</p>
      <div className="countdown" aria-hidden><span style={{ width: `${(left / 60) * 100}%` }} /></div>
      <div className="approval-actions">
        <button className="btn danger" disabled={busy} onClick={() => void answer('denied')}>Deny</button>
        <button className="btn good" disabled={busy} onClick={() => void answer('approved')}>Approve · {left}s</button>
      </div>
      {error && <p className="form-error inline" role="alert">{error}</p>}
    </dialog>
  );
}
