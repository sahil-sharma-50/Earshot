import { useState } from 'react';
import { ChevronRight, Loader2, Wand2 } from 'lucide-react';
import { modePolicy } from '@earshot/shared';
import { reruns, type RunView } from '../reduce.js';
import { startFix } from '../api.js';
import { findingTitle, GLOSSARY } from '../narrative.js';
import { ListenButton } from '../components/ListenButton.js';
import { Dialog } from '../ui/Dialog.js';
import { Toggletip } from '../ui/Toggletip.js';
import { formatLeft } from '../ui/clock.js';
import type { Selection } from './selection.js';

const STATUS = { open: 'Blocks the journey', fixing: 'Fixing', verified: 'Fix verified', unverified: 'Fix not verified' } as const;

export function Findings({ runId, view, isStarter, now, sel, onSelect, fixOpen, setFixOpen }: {
  runId: string; view: RunView; isStarter: boolean; now: number; sel: Selection; onSelect: (s: Selection) => void;
  fixOpen: boolean; setFixOpen: (b: boolean) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = view.findings.filter((f) => f.confirmed);
  const unconfirmed = view.findings.filter((f) => !f.confirmed);
  const started = reruns(view).length > 0 || view.phase === 'fixing';
  const canFix = isStarter && confirmed.length > 0 && !started && !view.finished && modePolicy(view.meta?.mode).fixable && view.phase === 'awaiting-fix';
  const verified = confirmed.filter((f) => f.status === 'verified').length;

  async function fix() {
    setSending(true);
    setError(null);
    try {
      await startFix(runId);
      setFixOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const row = (f: (typeof view.findings)[number]) => {
    const on = sel.kind === 'finding' && sel.id === f.id;
    return (
      <li key={f.id}>
        <button type="button" className={`finding-row${on ? ' on' : ''}${f.confirmed ? '' : ' unconfirmed'}`} aria-pressed={on} onClick={() => onSelect({ kind: 'finding', id: f.id })}>
          <span className="finding-title">{findingTitle(f, view.meta?.mode)}</span>
          <span className="finding-status">{f.confirmed ? STATUS[f.status] : 'Not counted'}</span>
          <ChevronRight size={16} aria-hidden />
        </button>
      </li>
    );
  };

  return (
    <section className="findings" aria-labelledby="findings-title">
      <header className="section-head">
        <h2 id="findings-title">Findings</h2>
        <Toggletip label="About findings">A finding is a point where the sighted agent got through and the blind agent did not. An inspector sandbox confirms the element really fails before it counts. {GLOSSARY.fix}</Toggletip>
        <p className="section-sub">
          {view.findings.length === 0
            ? 'Where the journeys diverge, the cause appears here.'
            : `${confirmed.length} confirmed${verified ? `, ${verified} fixed and verified` : ''}${unconfirmed.length ? `, ${unconfirmed.length} not counted` : ''}.`}
        </p>
        <div className="section-actions">
          {view.findings.length > 0 && <ListenButton runId={runId} agent="blind" label="Listen as the blind agent" />}
          {canFix && (
            <button type="button" className="btn primary" onClick={() => setFixOpen(true)}>
              <Wand2 size={16} aria-hidden /> Start Fix & verify
              {view.fixDeadlineAt && <span className="btn-note">{formatLeft(view.fixDeadlineAt - now)} left</span>}
            </button>
          )}
          {!isStarter && confirmed.length > 0 && view.phase === 'awaiting-fix' && <span className="watch-note">Only the person who started this run can start Fix & verify.</span>}
        </div>
      </header>
      {view.findings.length === 0
        ? <p className="empty">{view.finished ? 'No divergence: nothing blocked the blind agent that didn’t also block the sighted one.' : 'Nothing yet. Findings appear after both agents finish.'}</p>
        : (
          <>
            <ul className="finding-list">{confirmed.map(row)}</ul>
            {unconfirmed.length > 0 && <><h3 className="sub-head">Not confirmed</h3><ul className="finding-list">{unconfirmed.map(row)}</ul></>}
          </>
        )}

      <Dialog
        open={fixOpen}
        title="Fix and verify?"
        onClose={() => setFixOpen(false)}
        actions={<>
          <button type="button" className="btn" onClick={() => setFixOpen(false)}>Not now</button>
          <button type="button" className="btn primary" disabled={sending} onClick={() => void fix()} autoFocus>
            {sending ? <Loader2 className="spin" size={16} aria-hidden /> : <Wand2 size={16} aria-hidden />} Start Fix & verify
          </button>
        </>}
      >
        <p>For each confirmed finding, Earshot will:</p>
        <ol className="plain-list numbered">
          <li>ask Vultr Serverless Inference for an attribute-only patch (role, aria-label, tabindex and similar), applied by a fixed template;</li>
          <li>load the demo store with the patch in a fresh sandbox;</li>
          <li>rerun the blind agent. The fix only counts if it gets past the blocked checkpoint.</li>
        </ol>
        <p className="muted">Up to 2 attempts per finding. The live store is never changed. Findings: {confirmed.map((f) => modePolicy(view.meta?.mode).label(f.milestone)).join(', ')}.</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </Dialog>
    </section>
  );
}
