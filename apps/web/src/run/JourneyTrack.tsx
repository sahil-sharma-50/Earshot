import type { MilestoneId } from '@earshot/shared';
import type { RunView } from '../reduce.js';
import { agentName, OUTCOME_LABEL } from '../labels.js';
import { checkpointsFor } from '../narrative.js';
import { Toggletip } from '../ui/Toggletip.js';
import { AgentIcon, toneOf } from './AgentIcon.js';
import { journeyRows } from './journey.js';

/** Both agents on the same checkpoints, so the point where their journeys diverge is obvious. */
export function JourneyTrack({ view, onCheckpoint, onFinding }: { view: RunView; onCheckpoint: (id: MilestoneId) => void; onFinding: (id: string) => void }) {
  const cps = checkpointsFor(view.meta?.mode);
  const rows = journeyRows(view);
  return (
    <section className="journey" aria-labelledby="journey-title">
      <header className="section-head">
        <h2 id="journey-title">Journey</h2>
        <Toggletip label="About the journey">Checkpoints are read from the store’s real state (page, cart, form), not from what the agent claims. Select a checkpoint to see the step where each agent reached it.</Toggletip>
        <p className="section-sub">Same goal, two ways of perceiving the page. Where the rows split is where a customer gets stuck.</p>
      </header>
      <div className="track-scroll">
        <table className="track">
          <thead>
            <tr>
              <th scope="col" className="track-agent"><span className="sr-only">Agent</span></th>
              {cps.map((c) => (
                <th scope="col" key={c.id}>
                  <button type="button" className="cp-btn" onClick={() => onCheckpoint(c.id)}>{c.label}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent} className={`tone-${toneOf(r.agent)}`}>
                <th scope="row" className="track-agent"><AgentIcon id={r.agent} size={16} /> {agentName(r.agent)}</th>
                {cps.map((c, i) => {
                  const hit = i < r.reached;
                  const end = r.endedAt?.index === i;
                  return (
                    <td key={c.id} className={hit ? 'hit' : end ? 'end' : ''}>
                      <span className="cell">
                        <span className="mark" aria-hidden />
                        <span className="sr-only">{hit ? 'reached' : end ? `stopped here: ${OUTCOME_LABEL[r.endedAt!.outcome]}` : 'not reached'}</span>
                        {end && (
                          <span className="end-label" aria-hidden>
                            {OUTCOME_LABEL[r.endedAt!.outcome]}
                          </span>
                        )}
                        {end && r.blockedBy && <button type="button" className="link-btn" onClick={() => onFinding(r.blockedBy!)}>See why</button>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
