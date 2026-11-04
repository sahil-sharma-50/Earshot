import { useState } from 'react';
import { ChevronDown, Loader2, Pause, Play, ShieldCheck, Square } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { pauseRun, resumeRun, stopRun } from '../api.js';
import { Dialog } from '../ui/Dialog.js';
import { controlsFor } from './controls.js';

const TITLE = { demo: 'Demo store run', drill: 'Injection drill', 'any-url': 'Any URL run' } as const;

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function RunHeader({ runId, view, isStarter, now, blocked, onSafety }: {
  runId: string; view: RunView; isStarter: boolean; now: number; blocked: number; onSafety: () => void;
}) {
  const c = controlsFor(view, isStarter, now);
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'stop'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);

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
  const title = mode === 'any-url' && view.meta ? hostOf(view.meta.target) : mode ? TITLE[mode] : 'Loading run…';
  return (
    <div className="run-top-row">
      <a className="wordmark" href="/">Earshot</a>
      <div className="run-id">
        <p className="run-title">{title}</p>
        {view.stopped && <span className="run-badge">Stopped</span>}
        {view.meta && (
          <button type="button" className="goal-toggle" aria-expanded={goalOpen} aria-controls="run-goal" onClick={() => setGoalOpen(!goalOpen)}>
            Goal <ChevronDown size={14} aria-hidden className={goalOpen ? 'flip' : ''} />
          </button>
        )}
      </div>
      <div className="run-actions">
        <button type="button" className={`chip-btn${blocked ? ' alert' : ''}`} onClick={onSafety}>
          <ShieldCheck size={16} aria-hidden /> Safety · {blocked} blocked
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
      {goalOpen && view.meta && <p className="goal-full" id="run-goal">{view.meta.goal}</p>}
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
        <p>Agents stop now and all sandboxes are destroyed. Any pending purchase is denied and the run is marked stopped.</p>
        <p className="muted">This can’t be undone. Steps and findings recorded so far stay visible.</p>
        {error && <p className="inline-error" role="alert">Stop failed: {error}</p>}
      </Dialog>
    </div>
  );
}
