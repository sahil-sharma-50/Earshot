import { useEffect, useState } from 'react';
import { Loader2, Maximize2, Radio } from 'lucide-react';
import { modePolicy, type AgentId } from '@earshot/shared';
import type { RunView, StepEvent } from '../reduce.js';
import { agentName } from '../labels.js';
import { agentState, plainAction, plainResult, reachedCount } from '../narrative.js';
import { shotUrl } from '../api.js';
import { ListenButton } from '../components/ListenButton.js';
import { AgentIcon, toneOf } from './AgentIcon.js';
import { CheckTrack } from './CheckTrack.js';
import { MAX_STEPS } from './work.js';
import type { Selection } from './selection.js';

const PERCEIVES = { sighted: 'looks at screenshots', blind: 'hears the screen reader', rerun: 'blind, with the fix applied' } as const;
const READER_ROWS = 12;

/** The newest step that carries what this agent perceived (a screenshot or the accessibility tree). */
function perceivedAt(steps: StepEvent[], upTo: number): StepEvent | undefined {
  for (let i = upTo; i >= 0; i--) if (steps[i]?.shotId || steps[i]?.axExcerpt) return steps[i];
  return undefined;
}

/**
 * One agent, live: what it perceives right now, what it just did and why, how far it got, and a
 * scrubber over its steps. Picking a step rewinds this screen; "Back to live" follows again.
 */
export function AgentScreen({ runId, id, view, now, onOpen }: {
  runId: string; id: AgentId; view: RunView; now: number; onOpen: (s: Selection) => void;
}) {
  const a = view.agents[id];
  const steps = a?.steps ?? [];
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [id]);
  const pos = pick === null ? steps.length - 1 : Math.min(pick, steps.length - 1);
  const step = steps[pos];
  const seen = perceivedAt(steps, pos);
  const st = agentState(view, id, now);
  const tone = toneOf(id);
  const policy = modePolicy(view.meta?.mode);
  const labels = policy.checkpoints.map((c) => c.label);
  const reached = reachedCount(view, id);
  const failed = a?.outcome && a.outcome !== 'gate' && a.outcome !== 'done';
  const live = st.tone === 'live' || st.tone === 'waiting';
  const r = step ? plainResult(step) : null;
  const tag = st.tone === 'failed' ? 'tag bad' : st.tone === 'done' ? 'tag ok' : st.tone === 'waiting' ? 'tag accent' : 'tag';

  return (
    <article className={`screen tone-${tone}${failed ? ' is-stuck' : ''}`} aria-labelledby={`screen-${id}`}>
      <header className="screen-head">
        <h3 id={`screen-${id}`}><AgentIcon id={id} size={16} />{agentName(id)}{tone === 'rerun' ? '' : ' agent'}</h3>
        <span className="screen-sub">{PERCEIVES[tone]}</span>
        <button type="button" className={tag} onClick={() => onOpen({ kind: 'status', key: a?.outcome ?? 'agents', title: `${agentName(id)}: ${st.label}` })} title={st.reason}>
          {st.tone === 'live' && <span className="live-dot" aria-hidden />}{st.label}
        </button>
      </header>

      {tone === 'sighted' ? (
        <div className="browser">
          <div className="browser-bar"><i /><i /><i /><span className="browser-url">{seen?.url ?? view.meta?.target ?? ''}</span></div>
          {seen?.shotId ? (
            <button type="button" className="browser-shot" onClick={() => onOpen({ kind: 'step', agent: id, index: seen.index })} aria-label={`Open step ${seen.index + 1} with its screenshot`}>
              <img src={shotUrl(runId, seen.shotId)} alt={`What the seeing agent saw at step ${seen.index + 1}`} />
              <span className="browser-zoom" aria-hidden><Maximize2 size={14} /></span>
            </button>
          ) : <ScreenWait view={view} id={id} />}
        </div>
      ) : (
        <div className="reader">
          <div className="reader-bar">
            <span className="reader-url">{seen?.url ?? view.meta?.target ?? 'Screen reader'}</span>
            {steps.length > 0 && <ListenButton runId={runId} agent={id} label="Listen" />}
          </div>
          {seen?.axExcerpt ? (
            <ol className="reader-list" aria-label={`What the ${agentName(id).toLowerCase()} agent heard at step ${seen.index + 1}`}>
              {seen.axExcerpt.slice(0, READER_ROWS).map((n) => (
                <li key={n.ref} className={n.actionable ? 'is-act' : ''}>
                  <code>{n.role}{n.name ? ` “${n.name.length > 60 ? n.name.slice(0, 59) + '…' : n.name}”` : ''}{n.states.length ? `, ${n.states.join(', ')}` : ''}</code>
                  {n.actionable && <span className="reader-tag">can use</span>}
                </li>
              ))}
              {seen.axExcerpt.length > READER_ROWS && (
                <li className="reader-more"><button type="button" className="link-btn" onClick={() => onOpen({ kind: 'step', agent: id, index: seen.index })}>All {seen.axExcerpt.length} items</button></li>
              )}
            </ol>
          ) : <ScreenWait view={view} id={id} />}
        </div>
      )}

      {step ? (
        <button type="button" className="screen-act" onClick={() => onOpen({ kind: 'step', agent: id, index: step.index })}>
          <span className="screen-act-n">#{step.index + 1}</span>
          <span className="screen-act-body">
            <span className="screen-act-what">{plainAction(step)}{r && !r.ok && <span className="screen-act-bad"> · {r.text}</span>}</span>
            {step.reasoning && <span className="screen-act-why"><b>Why:</b> {step.reasoning}</span>}
          </span>
        </button>
      ) : null}

      <CheckTrack labels={labels} reached={reached} stoppedAt={failed ? reached : undefined} here={live} tone={tone} label={`${agentName(id)} agent checkpoints`} />

      <div className="scrub">
        <div className="scrub-ticks" role="group" aria-label={`${agentName(id)} steps`}>
          {Array.from({ length: Math.max(MAX_STEPS, steps.length) }, (_, i) => {
            const s = steps[i];
            if (!s) return <span key={i} className="tick is-empty" aria-hidden />;
            const gained = s.milestones.length > (steps[i - 1]?.milestones.length ?? 0);
            const on = i === pos;
            return (
              <button
                key={i}
                type="button"
                className={`tick${gained ? ' is-gain' : ''}${s.result.ok ? '' : ' is-bad'}${on ? ' is-on' : ''}`}
                aria-pressed={on}
                aria-label={`Step ${i + 1}: ${plainAction(s)}`}
                title={`Step ${i + 1}: ${plainAction(s)}`}
                onClick={() => setPick(i === steps.length - 1 ? null : i)}
              />
            );
          })}
        </div>
        {pick !== null && pick < steps.length - 1 ? (
          <button type="button" className="chip-btn scrub-live" onClick={() => setPick(null)}><Radio size={14} aria-hidden /> Back to {live ? 'live' : 'last step'}</button>
        ) : live ? <span className="scrub-note"><span className="live-dot" aria-hidden />Live</span>
          : <span className="scrub-note">{steps.length} step{steps.length === 1 ? '' : 's'}</span>}
      </div>
    </article>
  );
}

function ScreenWait({ view, id }: { view: RunView; id: AgentId }) {
  const a = view.agents[id];
  const text = view.finished ? 'This agent never started.' : a?.sandbox ? 'Opening the page in a real Chrome…' : view.queuePosition ? 'Waiting for a free sandbox slot…' : 'Creating its sandbox…';
  return <p className="screen-wait">{!view.finished && <Loader2 size={16} className="spin" aria-hidden />}{text}</p>;
}
