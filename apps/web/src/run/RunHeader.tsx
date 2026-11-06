import { useState } from 'react';
import { Loader2, Pause, Play, ShieldCheck, Square } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { pauseRun, resumeRun, stopRun } from '../api.js';
import { Dialog } from '../ui/Dialog.js';
import { controlsFor } from './controls.js';
import { hostOf } from './Brief.js';

const TITLE = { demo: 'Testing the demo store', drill: 'Prompt-injection test', 'any-url': 'Any URL run' } as const;

export function RunHeader({ runId, view, isStarter, now, blocked, onSafety }: {
  runId: string; view: RunView; isStarter: boolean; now: number; blocked: number; onSafety: () => void;
}) {
  const c = controlsFor(view, isStarter, now);
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'stop'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  async function act(kind: 'pause' | 'resume' | 'stop') {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'pause' ? pauseRun : kind === 'resume' ? resumeRun : stopRun)(runId);
      if (kind === 'stop') setConfirmStop(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const mode = view.meta?.mode;
  const title = mode === 'any-url' && view.meta ? `Testing ${hostOf(view.meta.target)}` : mode ? TITLE[mode] : 'Loading run…';
  return (
    <div className="run-top-row">
      <a className="wordmark" href="/" aria-label="Earshot home">Ear<span>shot</span></a>
      <div className="run-id">
        <div className="run-name">
          <h1 className="run-title">{title}{view.stopped && <span className="run-badge">Stopped</span>}</h1>
          {view.meta && <p className="run-goal">Goal on {hostOf(view.meta.target)}: {view.meta.goal}</p>}
        </div>
      </div>
      <div className="run-actions">
        <button type="button" className={`chip-btn${blocked ? ' alert' : ''}`} onClick={onSafety}>
          <ShieldCheck size={16} aria-hidden /> Safety: {blocked} blocked
        </button>
        {c.pause && (
          <button type="button" className="btn" disabled={!!busy} onClick={() => void act('pause')}>
            {busy === 'pause' ? <Loader2 className="spin" size={16} aria-hidden /> : <Pause size={16} aria-hidden />} Pause
          </button>
        )}
        {c.resume && (
          <button type="button" className="btn" disabled={!!busy} onClick={() => void act('resume')}>
            {busy === 'resume' ? <Loader2 className="spin" size={16} aria-hidden /> : <Play size={16} aria-hidden />} Resume
          </button>
        )}
        {c.stop && (
          <button type="button" className="btn ghost-danger" disabled={!!busy} onClick={() => setConfirmStop(true)}>
            <Square size={14} aria-hidden /> Stop
          </button>
        )}
        {c.note && view.meta && !view.finished && <span className="watch-note">{c.note}</span>}
        {error && <span className="inline-error" role="alert">{error}</span>}
      </div>
      <Dialog
        open={confirmStop}
        title="Stop this run?"
        onClose={() => setConfirmStop(false)}
        actions={<>
          <button type="button" className="btn" onClick={() => setConfirmStop(false)} autoFocus>Keep running</button>
          <button type="button" className="btn danger" disabled={busy === 'stop'} onClick={() => void act('stop')}>
            {busy === 'stop' && <Loader2 className="spin" size={16} aria-hidden />} Stop run
          </button>
        </>}
      >
        <p>The agents stop right away and every sandbox is deleted. Any final click waiting for approval is denied.</p>
        <p className="muted">This can’t be undone. Steps and findings recorded so far stay visible.</p>
        {error && <p className="inline-error" role="alert">Stop failed: {error}</p>}
      </Dialog>
    </div>
  );
}
