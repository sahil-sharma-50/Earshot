import { modePolicy } from '@earshot/shared';
import type { RunView } from '../reduce.js';
import { agentName, OUTCOME_LABEL } from '../labels.js';
import { elementName } from '../narrative.js';
import { AgentIcon, toneOf } from './AgentIcon.js';
import { CheckTrack } from './CheckTrack.js';
import { journeyRows } from './journey.js';
import type { Selection } from './selection.js';

/** Where the agents' journeys split: the first checkpoint the seeing agent passed and a blind one did not. */
export function splitPoint(view: RunView): { label: string; outcome: string; findingId?: string; element?: string } | null {
  const rows = journeyRows(view);
  const sighted = rows.find((r) => r.agent === 'sighted');
  const blind = rows.find((r) => r.agent === 'blind');
  if (!sighted || !blind?.endedAt || sighted.reached <= blind.reached) return null;
  const cp = modePolicy(view.meta?.mode).checkpoints[blind.endedAt.index];
  if (!cp) return null;
  const f = blind.blockedBy ? view.findings.find((x) => x.id === blind.blockedBy) : undefined;
  return { label: cp.label, outcome: OUTCOME_LABEL[blind.endedAt.outcome], findingId: f?.id, element: f ? elementName(f.element.snippet) : undefined };
}

/** Every agent on the same checkpoints, so the place where the blind ones fell short is obvious. */
export function HowFar({ view, onOpen }: { view: RunView; onOpen: (s: Selection) => void }) {
  const labels = modePolicy(view.meta?.mode).checkpoints.map((c) => c.label);
  const rows = journeyRows(view).filter((r) => view.agents[r.agent]);
  return (
    <section className="card howfar" aria-labelledby="howfar-title">
      <h2 id="howfar-title" className="card-title">How far each agent got</h2>
      <div className="howfar-rows">
        {rows.map((r) => (
          <div key={r.agent} className={`howfar-row tone-${toneOf(r.agent)}`}>
            <span className="howfar-who"><AgentIcon id={r.agent} size={15} />{r.agent.startsWith('rerun-') ? `${agentName(r.agent)} with fix` : agentName(r.agent)}</span>
            <CheckTrack labels={labels} reached={r.reached} stoppedAt={r.endedAt?.index} tone={toneOf(r.agent)} label={`${agentName(r.agent)} checkpoints`} />
            {r.endedAt ? (
              <span className="howfar-end">
                {OUTCOME_LABEL[r.endedAt.outcome]}
                {r.blockedBy && <button type="button" className="link-btn" onClick={() => onOpen({ kind: 'finding', id: r.blockedBy! })}>See why</button>}
              </span>
            ) : <span className="howfar-end is-ok">{r.reached >= labels.length ? 'Made it' : view.agents[r.agent]?.outcome ? OUTCOME_LABEL[view.agents[r.agent]!.outcome!] : 'Running'}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
