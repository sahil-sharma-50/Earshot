import { useEffect, useRef, useState } from 'react';
import { Ban, Flag, X } from 'lucide-react';
import type { AgentId } from '@earshot/shared';
import { useRunEvents } from '../sse.js';
import { reruns } from '../reduce.js';
import { getToken } from '../api.js';
import { agentName } from '../labels.js';
import { nowLine, phaseSteps } from '../narrative.js';
import { ApprovalModal } from '../components/ApprovalModal.js';
import { Dialog } from '../ui/Dialog.js';
import { useNow } from '../ui/clock.js';
import { RunHeader } from '../run/RunHeader.js';
import { NowBanner } from '../run/NowBanner.js';
import { StageLine } from '../run/StageLine.js';
import { WorkPipeline } from '../run/WorkPipeline.js';
import { AgentScreen } from '../run/AgentScreen.js';
import { HowFar, splitPoint } from '../run/HowFar.js';
import { Result } from '../run/Result.js';
import { SafetySummary } from '../run/SafetySummary.js';
import { Findings } from '../run/Findings.js';
import { DetailPanel } from '../run/DetailPanel.js';
import { describeEvent } from '../run/events.js';
import type { Selection } from '../run/selection.js';

const DRAWER_TITLE: Record<Selection['kind'], string> = { overview: 'How it works and safety', step: 'Step', finding: 'Finding', event: 'Safety event', status: 'What this means' };

export function Run({ runId }: { runId: string }) {
  const { view, lost } = useRunEvents(runId);
  const isStarter = !!getToken(runId);
  const now = useNow(500, !view.finished);
  const [sel, setSel] = useState<Selection | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [rerunPick, setRerunPick] = useState<AgentId | null>(null);
  const rr = reruns(view);
  const rerun = rerunPick && rr.includes(rerunPick) ? rerunPick : rr.at(-1);

  // The starter sees the purchase dialog as soon as an approval is requested; it closes when resolved (or on Stop).
  useEffect(() => { setApprovalOpen(!!view.approval && isStarter); }, [view.approval?.approvalId, isStarter]); // eslint-disable-line react-hooks/exhaustive-deps

  // A newly blocked request raises a non-modal alert for 10 s: the run's visible containment moment. It stays in the safety log.
  const blockedEvents = view.containment.map((e, i) => ({ e, i })).filter((x) => x.e.t === 'containment.blocked');
  const [alert, setAlert] = useState<number | null>(null);
  const seen = useRef(0);
  useEffect(() => {
    if (blockedEvents.length > seen.current) {
      seen.current = blockedEvents.length;
      setAlert(blockedEvents.at(-1)!.i);
      const t = setTimeout(() => setAlert(null), 10_000);
      return () => clearTimeout(t);
    }
  }, [blockedEvents.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const alertEvent = alert !== null ? view.containment[alert] : undefined;

  const finished = !!view.finished;
  const pair: AgentId[] = rerun ? ['blind', rerun] : ['sighted', 'blind'];
  const split = splitPoint(view);
  const steps = phaseSteps(view);
  const aside = finished ? undefined : (['sighted', 'blind', ...rr] as AgentId[])
    .filter((id) => view.agents[id]?.steps.length)
    .map((id) => `${agentName(id)}: step ${view.agents[id]!.steps.length}`)
    .join(' · ') || undefined;

  return (
    <div className="run">
      <header className="run-top">
        <RunHeader runId={runId} view={view} isStarter={isStarter} now={now} blocked={blockedEvents.length} onSafety={() => setSel({ kind: 'overview' })} />
        <StageLine steps={steps} aside={aside} />
      </header>

      {(!finished || lost) && (
        <NowBanner line={nowLine(view, isStarter, now)} lost={lost} finished={finished} onAction={(k) => (k === 'approval' ? setApprovalOpen(true) : setFixOpen(true))} />
      )}

      {alertEvent && (
        <div className="alert-bar" role="status">
          <Ban size={16} aria-hidden />
          <span><strong>Contained.</strong> The egress gate {describeEvent(alertEvent, view.meta?.mode).title.replace(/^Blocked/, 'blocked')}. The sandbox has no other way out.</span>
          <button type="button" className="btn small" onClick={() => setSel({ kind: 'event', i: alert! })}>View in log</button>
          <button type="button" className="icon-btn" onClick={() => setAlert(null)} aria-label="Dismiss alert"><X size={16} aria-hidden /></button>
        </div>
      )}

      {finished ? (
        <div className="run-done">
          <main className="run-done-main">
            <Result runId={runId} view={view} isStarter={isStarter} onOpen={setSel} />
            <HowFar view={view} onOpen={setSel} />
          </main>
          <aside className="run-done-side" aria-label="Where the work ran and safety">
            <WorkPipeline view={view} variant="column" />
            <SafetySummary view={view} onLog={() => setSel({ kind: 'overview' })} />
          </aside>
        </div>
      ) : (
        <main className="run-live">
          <WorkPipeline view={view} variant="row" />
          <section className="screens-wrap" aria-label="The agents, live">
            {rr.length > 1 && (
              <div className="segmented" role="group" aria-label="Which fix attempt to show">
                {rr.map((r) => <button type="button" key={r} aria-pressed={r === rerun} onClick={() => setRerunPick(r)}>{agentName(r)} with fix</button>)}
              </div>
            )}
            <div className="screens">
              {pair.map((id) => <AgentScreen key={id} runId={runId} id={id} view={view} now={now} onOpen={setSel} />)}
            </div>
            {split && (
              <div className="split">
                <span className="split-icon" aria-hidden><Flag size={18} /></span>
                <div>
                  <p className="split-main">They split at <b>{split.label}</b>. The seeing agent got past it; the blind agent stopped ({split.outcome.toLowerCase()}).</p>
                  <p className="split-sub">{split.element ? `Confirmed: ${split.element} is what blocked it.` : 'A fresh sandbox re-checks that exact element before it counts as a finding.'}</p>
                </div>
                {split.findingId && <button type="button" className="btn small" onClick={() => setSel({ kind: 'finding', id: split.findingId! })}>See why</button>}
              </div>
            )}
          </section>
          {(view.findings.length > 0 || view.phase === 'awaiting-fix') && (
            <Findings runId={runId} view={view} isStarter={isStarter} now={now} sel={sel ?? { kind: 'overview' }} onSelect={setSel} fixOpen={fixOpen} setFixOpen={setFixOpen} />
          )}
        </main>
      )}

      <Dialog open={sel !== null} title={sel ? DRAWER_TITLE[sel.kind] : 'Details'} onClose={() => setSel(null)} variant="drawer">
        {sel && <DetailPanel runId={runId} view={view} sel={sel} follow={false} onSelect={setSel} />}
      </Dialog>
      {view.approval && isStarter && (
        <ApprovalModal runId={runId} approval={view.approval} open={approvalOpen} onClose={() => setApprovalOpen(false)} now={now} />
      )}
    </div>
  );
}
