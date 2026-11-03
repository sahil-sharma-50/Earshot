import { CircleCheck, CircleX, Loader2, WifiOff } from 'lucide-react';
import { useRunEvents } from '../sse.js';
import { reruns } from '../reduce.js';
import { AgentColumn } from '../components/AgentColumn.js';
import { ContainmentRail } from '../components/ContainmentRail.js';

function Status({ view, lost }: { view: ReturnType<typeof useRunEvents>['view']; lost: boolean }) {
  if (view.finished) {
    return view.finished.verified
      ? <span className="status good"><CircleCheck size={18} aria-hidden /> Journey verified end to end</span>
      : <span className="status bad"><CircleX size={18} aria-hidden /> {view.finished.error ? `Run ended: ${view.finished.error}` : 'Run finished, journey not verified'}</span>;
  }
  if (lost) return <span className="status bad"><WifiOff size={18} aria-hidden /> Connection lost. Reload to catch up.</span>;
  if (view.queuePosition) return <span className="status"><Loader2 className="spin" size={18} aria-hidden /> In queue, position {view.queuePosition}</span>;
  return <span className="status live"><span className="pulse" aria-hidden /> Live</span>;
}

export function Run({ runId }: { runId: string }) {
  const { view, lost } = useRunEvents(runId);
  const rr = reruns(view);
  const third = rr.at(-1);
  return (
    <div className="run">
      <header className="topbar">
        <a className="wordmark" href="/">Earshot</a>
        <div className="run-meta">
          {view.meta && <span className="mode">{view.meta.mode === 'drill' ? 'Injection drill' : view.meta.mode === 'any-url' ? 'Any URL' : 'Demo store'}</span>}
          <p className="run-goal" title={view.meta?.goal}>{view.meta?.goal ?? 'Loading run…'}</p>
        </div>
        <Status view={view} lost={lost} />
      </header>

      <div className={`run-grid${third ? ' three' : ''}`}>
        <AgentColumn runId={runId} id="sighted" view={view.agents.sighted} />
        <AgentColumn runId={runId} id="blind" view={view.agents.blind} />
        {third && <AgentColumn runId={runId} id={third} view={view.agents[third]} />}
        <ContainmentRail events={view.containment} />
      </div>
    </div>
  );
}
