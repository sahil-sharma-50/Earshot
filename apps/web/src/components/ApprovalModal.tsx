import { useState } from 'react';
import { Hand, Loader2 } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { decide } from '../api.js';
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
