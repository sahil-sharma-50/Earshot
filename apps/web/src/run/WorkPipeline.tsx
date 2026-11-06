import { Ban, Box, Cpu, Globe, KeyRound, Server, ShieldCheck } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { agentName, cpus, gib } from '../labels.js';
import { AgentIcon } from './AgentIcon.js';
import { hostOf } from './Brief.js';
import { MAX_STEPS, workState } from './work.js';

const ENDED: Record<string, string> = { finished: 'deleted', stopped: 'deleted (stopped)', timeout: 'deleted (time cap)', error: 'deleted (error)' };
const host = (h: string) => (h === '169.254.169.254' ? '169.254.169.254 (cloud metadata)' : h);

/**
 * Where the work runs: server → sandboxes → egress gate → website. `row` is the live pipeline under
 * the stage line; `column` is the same story told as a record next to the finished result.
 */
export function WorkPipeline({ view, variant }: { view: RunView; variant: 'row' | 'column' }) {
  const w = workState(view);
  const site = view.meta ? hostOf(view.meta.target) : 'The website';
  const running = w.live > 0;
  // the agent's own budget (15 steps / 120 s) ends it; the sandbox kill timer is only a backstop, so it stays out of the headline
  const limits = w.limits
    ? `${gib(w.limits.memoryBytes)} · ${cpus(w.limits.nanoCpus)} · ${w.limits.pidsLimit} processes · ${MAX_STEPS} steps or 120 s per agent`
    : `1 GiB · 0.75 CPU · 256 processes · ${MAX_STEPS} steps or 120 s per agent`;
  const shown = variant === 'row' ? w.sandboxes.filter((s) => s.live) : w.sandboxes;
  const heading = variant === 'row' ? 'Where the work runs' : 'Where the work ran';

  return (
    <section className={`work work-${variant}${running ? ' is-live' : ''}`} aria-labelledby={`work-${variant}`}>
      <header className="work-head">
        <h2 id={`work-${variant}`}>{running && <span className="live-dot" aria-hidden />}{heading}{running ? ', live' : ''}</h2>
        <p>Each sandbox: {limits}</p>
      </header>
      <ol className="work-flow">
        <li className="work-node">
          <div className="work-title"><span className="work-icon"><Server size={16} aria-hidden /></span><div><b>Earshot server</b><small>Vultr Cloud Compute</small></div></div>
          <ul className="work-facts">
            <li><Cpu size={13} aria-hidden />AI on Vultr Serverless Inference picks each step</li>
            <li><KeyRound size={13} aria-hidden />API keys stay here</li>
          </ul>
        </li>
        <li className="work-link">
          <span>one action</span><i className="work-line">{running && <b className="pkt" />}</i><small>click, type, scroll</small>
        </li>
        <li className="work-node work-sbx">
          <div className="work-title">
            <span className="work-icon"><Box size={16} aria-hidden /></span>
            <div><b>{running ? `${w.live} sealed sandbox${w.live === 1 ? '' : 'es'}` : w.started ? `${w.started} sealed sandbox${w.started === 1 ? '' : 'es'}` : 'Sealed sandboxes'}</b><small>gVisor · 0 keys inside</small></div>
          </div>
          {shown.length > 0 ? (
            <ul className="work-lanes">
              {shown.map((s) => (
                <li key={s.agent}>
                  <AgentIcon id={s.agent} size={14} />
                  <span className="work-lane-name">{agentName(s.agent)}</span>
                  {s.live && s.agent === 'inspector' ? <span className="work-lane-note work-lane-end">re-checking the element</span> : s.live ? (
                    <>
                      <span className="work-meter" role="meter" aria-label={`${agentName(s.agent)} steps used`} aria-valuemin={0} aria-valuemax={MAX_STEPS} aria-valuenow={s.steps}>
                        <span style={{ width: `${Math.min(100, (s.steps / MAX_STEPS) * 100)}%` }} />
                      </span>
                      <span className="work-lane-note">step {s.steps} of {MAX_STEPS}</span>
                    </>
                  ) : <span className="work-lane-note work-lane-end">{s.ended ? ENDED[s.ended] ?? 'deleted' : 'ended'}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="work-wait">
              {w.started
                ? `None running right now. All ${w.started} so far were deleted when their agent finished.`
                : view.finished ? 'None were started.' : 'Starting a real Chrome in each sandbox…'}
            </p>
          )}
        </li>
        <li className="work-link work-link-gate">
          <span>no route out</span><i className="work-line" /><small>except the gate</small>
        </li>
        <li className={`work-node work-gate${w.blocked ? ' has-blocked' : ''}`}>
          <div className="work-title"><span className="work-icon"><ShieldCheck size={16} aria-hidden /></span><div><b>Egress gate</b><small>allow list only</small></div></div>
          <div className="work-counts">
            <span><small>Allowed</small><b>{site} and the AI model</b></span>
            <span className={w.blocked ? 'is-bad' : ''}><small>Blocked</small><b>{w.blocked}</b></span>
          </div>
          {w.lastBlocked && <p className="work-last"><Ban size={12} aria-hidden />{agentName(w.lastBlocked.agent).toLowerCase()} → {host(w.lastBlocked.host)}</p>}
        </li>
        <li className="work-link">
          <span>allowed</span><i className="work-line">{running && <b className="pkt pkt-late" />}</i><small>page loads</small>
        </li>
        <li className="work-node">
          <div className="work-title"><span className="work-icon"><Globe size={16} aria-hidden /></span><div><b>{site}</b><small>the real website</small></div></div>
          <p className="work-note">The page reacts, and what changed goes back to the server for the next step.</p>
        </li>
      </ol>
    </section>
  );
}
