import { useState } from 'react';
import { CircleCheck, CircleX, Loader2, Wand2, WifiOff } from 'lucide-react';
import { useRunEvents } from '../sse.js';
import { reruns, type RunView } from '../reduce.js';
import { getToken, startFix } from '../api.js';
import { AgentColumn } from '../components/AgentColumn.js';
import { ContainmentRail } from '../components/ContainmentRail.js';
import { FindingCard } from '../components/FindingCard.js';
import { ApprovalModal } from '../components/ApprovalModal.js';
import { ListenButton } from '../components/ListenButton.js';

function Status({ view, lost }: { view: RunView; lost: boolean }) {
  if (view.finished) {
    return view.finished.verified
      ? <span className="status good"><CircleCheck size={18} aria-hidden /> Journey verified end to end</span>
      : <span className="status bad"><CircleX size={18} aria-hidden /> {view.finished.error ? `Run ended: ${view.finished.error}` : 'Run finished, journey not verified'}</span>;
  }
  if (lost) return <span className="status bad"><WifiOff size={18} aria-hidden /> Connection lost. Reload to catch up.</span>;
  if (view.queuePosition) return <span className="status"><Loader2 className="spin" size={18} aria-hidden /> In queue, position {view.queuePosition}</span>;
  return <span className="status live"><span className="pulse" aria-hidden /> Live</span>;
}

function Findings({ runId, view, isStarter }: { runId: string; view: RunView; isStarter: boolean }) {
  const [fixState, setFixState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [fixError, setFixError] = useState<string | null>(null);
  if (view.findings.length === 0) return null;
  const confirmed = view.findings.some((f) => f.confirmed);
  const started = reruns(view).length > 0 || fixState === 'sent';
  const canFix = isStarter && confirmed && !started && !view.finished && view.meta?.mode !== 'any-url';

  async function fix() {
    setFixState('sending');
    try {
      await startFix(runId);
      setFixState('sent');
    } catch (e) {
      setFixError((e as Error).message);
      setFixState('error');
    }
  }

  return (
    <section className="findings" aria-label="Findings">
      <header className="findings-head">
        <h2>Findings <span className="count">{view.findings.filter((f) => f.confirmed).length} confirmed</span></h2>
        <ListenButton runId={runId} agent="blind" label="Listen as the blind agent" />
        {canFix && (
          <button className="btn primary" onClick={() => void fix()} disabled={fixState === 'sending'}>
            {fixState === 'sending' ? <Loader2 className="spin" size={18} aria-hidden /> : <Wand2 size={18} aria-hidden />} Fix &amp; verify
          </button>
        )}
        {!isStarter && confirmed && !started && !view.finished && view.meta?.mode !== 'any-url' && <span className="small">Only the person who started this run can start Fix &amp; verify.</span>}
        {fixError && <span className="form-error inline" role="alert">{fixError}</span>}
      </header>
      <div className="finding-list">
        {view.findings.map((f) => (
          <FindingCard key={f.id} runId={runId} finding={f} fixes={view.fixes[f.id] ?? []} sightedStep={view.agents.sighted?.steps.find((s) => s.index === f.evidence.sightedStep)} />
        ))}
      </div>
    </section>
  );
}

export function Run({ runId }: { runId: string }) {
  const { view, lost } = useRunEvents(runId);
  const isStarter = !!getToken(runId);
  const rr = reruns(view);
  const third = rr.at(-1);
  return (
    <div className={`run${view.findings.length ? ' has-findings' : ''}`}>
      <header className="topbar">
        <a className="wordmark" href="/">Earshot</a>
        <div className="run-meta">
          {view.meta && <span className="mode">{view.meta.mode === 'drill' ? 'Injection drill' : view.meta.mode === 'any-url' ? 'Any URL' : 'Demo store'}</span>}
          <p className="run-goal" title={view.meta?.goal}>{view.meta?.goal ?? 'Loading run…'}</p>
        </div>
        <Status view={view} lost={lost} />
      </header>

      {view.approval && <ApprovalModal runId={runId} approval={view.approval} canDecide={isStarter} />}

      <div className={`run-grid${third ? ' three' : ''}`}>
        <AgentColumn runId={runId} id="sighted" view={view.agents.sighted} />
        <AgentColumn runId={runId} id="blind" view={view.agents.blind} />
        {third && <AgentColumn runId={runId} id={third} view={view.agents[third]} />}
        <ContainmentRail events={view.containment} />
      </div>

      <Findings runId={runId} view={view} isStarter={isStarter} />
    </div>
  );
}
