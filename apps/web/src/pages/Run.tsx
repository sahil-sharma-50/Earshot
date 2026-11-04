import { useEffect, useRef, useState } from 'react';
import { Ban, Ear, Eye, Wrench, X } from 'lucide-react';
import type { AgentId, MilestoneId } from '@earshot/shared';
import { useRunEvents } from '../sse.js';
import { reruns } from '../reduce.js';
import { getToken } from '../api.js';
import { agentName } from '../labels.js';
import { nowLine, phaseSteps } from '../narrative.js';
import { ApprovalModal } from '../components/ApprovalModal.js';
import { Dialog } from '../ui/Dialog.js';
import { useMedia, useNow } from '../ui/clock.js';
import { RunHeader } from '../run/RunHeader.js';
import { NowBanner } from '../run/NowBanner.js';
import { PhaseStrip } from '../run/PhaseStrip.js';
import { JourneyTrack } from '../run/JourneyTrack.js';
import { AgentLane } from '../run/AgentLane.js';
import { DetailPanel } from '../run/DetailPanel.js';
import { Findings } from '../run/Findings.js';
import { describeEvent } from '../run/events.js';
import { stepAtCheckpoint, useSelection, type Selection } from '../run/selection.js';

type LaneKey = 'sighted' | 'blind' | 'verify';

export function Run({ runId }: { runId: string }) {
  const { view, lost } = useRunEvents(runId);
  const isStarter = !!getToken(runId);
  const now = useNow(500, !view.finished);
  const compact = useMedia('(max-width: 1199px)');
  const { sel, follow, select, setFollow } = useSelection(view);
  const [drawer, setDrawer] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [laneTab, setLaneTab] = useState<LaneKey>('blind');
  const [rerunPick, setRerunPick] = useState<AgentId | null>(null);
  const rr = reruns(view);
  const rerun = rerunPick && rr.includes(rerunPick) ? rerunPick : rr.at(-1);

  // The starter sees the purchase dialog as soon as an approval is requested; it closes when resolved (or on Stop).
  useEffect(() => { setApprovalOpen(!!view.approval && isStarter); }, [view.approval?.approvalId, isStarter]); // eslint-disable-line react-hooks/exhaustive-deps

  // A newly blocked request raises a non-modal alert for 10 s; it stays in the Safety log.
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

  const pick = (s: Selection) => { select(s); if (compact) setDrawer(true); };
  const onCheckpoint = (id: MilestoneId) => {
    const agent: AgentId = view.agents.blind?.steps.length ? 'blind' : 'sighted';
    const index = stepAtCheckpoint(view, agent, id);
    if (index !== null) pick({ kind: 'step', agent, index });
  };
  const alertEvent = alert !== null ? view.containment[alert] : undefined;
  const live = !view.finished && !lost;

  const lane = (id: AgentId) => <AgentLane key={id} id={id} view={view} now={now} sel={sel} follow={follow} onSelect={pick} />;
  const verifyLane = rerun && (
    <div className="verify-lane">
      {rr.length > 1 && (
        <div className="segmented" role="group" aria-label="Verification rerun">
          {rr.map((r) => <button type="button" key={r} aria-pressed={r === rerun} onClick={() => setRerunPick(r)}>{agentName(r)}</button>)}
        </div>
      )}
      {lane(rerun)}
    </div>
  );
  const detail = <DetailPanel runId={runId} view={view} sel={sel} follow={follow && !compact} onSelect={pick} />;

  return (
    <div className="run">
      <header className="run-top">
        <RunHeader runId={runId} view={view} isStarter={isStarter} now={now} blocked={blockedEvents.length} onSafety={() => pick({ kind: 'overview' })} />
        <NowBanner line={nowLine(view, isStarter, now)} lost={lost} finished={!!view.finished} onAction={(k) => (k === 'approval' ? setApprovalOpen(true) : setFixOpen(true))} />
      </header>

      {alertEvent && (
        <div className="alert-bar" role="status">
          <Ban size={16} aria-hidden />
          <span><strong>Containment blocked a request.</strong> {describeEvent(alertEvent).title}</span>
          <button type="button" className="btn small" onClick={() => pick({ kind: 'event', i: alert! })}>View</button>
          <button type="button" className="icon-btn" onClick={() => setAlert(null)} aria-label="Dismiss alert"><X size={16} aria-hidden /></button>
        </div>
      )}

      <div className="run-body">
        <main className="run-main">
          <PhaseStrip steps={phaseSteps(view)} />
          <JourneyTrack view={view} onCheckpoint={onCheckpoint} onFinding={(id) => pick({ kind: 'finding', id })} />

          <section className="lanes-wrap" aria-label="Agent activity">
            <header className="section-head">
              <h2>Agent activity</h2>
              <p className="section-sub">Every action each agent took, oldest first. Select a step to see why it acted and what it perceived.</p>
              {live && !follow && <button type="button" className="chip-btn" onClick={() => setFollow(true)}><span className="live-dot" aria-hidden /> Jump to live</button>}
              {live && follow && <span className="follow-note"><span className="live-dot" aria-hidden /> Following live</span>}
            </header>
            {compact ? (
              <>
                <div className="segmented lane-tabs" role="group" aria-label="Show agent">
                  <button type="button" aria-pressed={laneTab === 'sighted'} onClick={() => setLaneTab('sighted')}><Eye size={16} aria-hidden /> Sighted</button>
                  <button type="button" aria-pressed={laneTab === 'blind'} onClick={() => setLaneTab('blind')}><Ear size={16} aria-hidden /> Blind</button>
                  {rerun && <button type="button" aria-pressed={laneTab === 'verify'} onClick={() => setLaneTab('verify')}><Wrench size={16} aria-hidden /> Verification</button>}
                </div>
                <div className="lanes one">{laneTab === 'verify' && rerun ? verifyLane : lane(laneTab === 'verify' ? 'blind' : laneTab)}</div>
              </>
            ) : (
              <div className={`lanes${rerun ? ' three' : ''}`}>
                {lane('sighted')}
                {lane('blind')}
                {verifyLane}
              </div>
            )}
          </section>

          <Findings runId={runId} view={view} isStarter={isStarter} now={now} sel={sel} onSelect={pick} fixOpen={fixOpen} setFixOpen={setFixOpen} />
        </main>
        {!compact && detail}
      </div>

      {compact && (
        <Dialog open={drawer} title="Details" onClose={() => setDrawer(false)} variant="drawer">{detail}</Dialog>
      )}
      {view.approval && isStarter && (
        <ApprovalModal runId={runId} approval={view.approval} open={approvalOpen} onClose={() => setApprovalOpen(false)} now={now} />
      )}
    </div>
  );
}
