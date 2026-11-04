import { useEffect, useRef } from 'react';
import { Box, Check, Loader2, X } from 'lucide-react';
import type { AgentId } from '@earshot/shared';
import type { RunView } from '../reduce.js';
import { agentName, cpus, gib, shortId } from '../labels.js';
import { agentState, plainAction, plainResult } from '../narrative.js';
import { Toggletip } from '../ui/Toggletip.js';
import { AgentIcon, toneOf } from './AgentIcon.js';
import type { Selection } from './selection.js';

const PERCEIVES: Record<string, string> = {
  sighted: 'Sees screenshots, like a sighted shopper',
  blind: 'Hears the accessibility tree, like a screen-reader user',
  rerun: 'The blind agent again, with the proposed fixes applied',
};

export function AgentLane({ id, view, now, sel, follow, onSelect }: {
  id: AgentId; view: RunView; now: number; sel: Selection; follow: boolean; onSelect: (s: Selection) => void;
}) {
  const a = view.agents[id];
  const steps = a?.steps ?? [];
  const st = agentState(view, id, now);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!follow) return;
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [steps.length, follow]);
  const sbx = a?.sandbox;
  const statusKey = a?.outcome ?? (st.tone === 'waiting' ? 'gate' : 'agents');
  return (
    <section className={`lane tone-${toneOf(id)}`} aria-labelledby={`lane-${id}`}>
      <header className="lane-head">
        <h3 id={`lane-${id}`}><AgentIcon id={id} /> {agentName(id)}{id.startsWith('rerun-') ? '' : ' agent'}</h3>
        <p className="lane-sub">{PERCEIVES[toneOf(id)]}</p>
        <button type="button" className={`state state-${st.tone}`} onClick={() => onSelect({ kind: 'status', key: statusKey, title: `${agentName(id)}: ${st.label}` })}>
          <span className="state-glyph" aria-hidden>
            {st.tone === 'live' && <span className="live-dot" />}
            {st.tone === 'done' && <Check size={14} />}
            {st.tone === 'failed' && <X size={14} />}
          </span>
          <span><strong>{st.label}</strong> <span className="state-why">{st.reason}</span></span>
        </button>
        <div className="sandbox-line">
          <Box size={14} aria-hidden />
          {sbx ? <>
            <span>Sandbox <span className="mono">{shortId(sbx.id)}</span></span>
            <span className={sbx.destroyed ? 'gone' : ''}>{sbx.destroyed ? `destroyed (${sbx.destroyed})` : 'live'}</span>
            <Toggletip label="Sandbox limits">{`${sbx.limits.runtime} (gVisor) · ${gib(sbx.limits.memoryBytes)} memory · ${cpus(sbx.limits.nanoCpus)} · ${sbx.limits.pidsLimit} processes · hard stop after ${Math.round(sbx.limits.timeoutMs / 1000)} s. No secrets inside; network only through the egress proxy.`}</Toggletip>
          </> : <><Loader2 size={14} className="spin" aria-hidden /> <span>Waiting for a sandbox</span></>}
        </div>
      </header>
      <ol className="steps" ref={list} aria-label={`${agentName(id)} steps`}>
        {steps.length === 0 && <li className="empty">Steps appear here as soon as this agent’s sandbox starts.</li>}
        {steps.map((s) => {
          const r = plainResult(s);
          const on = sel.kind === 'step' && sel.agent === id && sel.index === s.index;
          return (
            <li key={`${s.index}-${s.action.type}`}>
              <button type="button" className={`step-row${on ? ' on' : ''}${r.ok ? '' : ' failed'}`} aria-pressed={on} onClick={() => onSelect({ kind: 'step', agent: id, index: s.index })}>
                <span className="step-n">{s.index + 1}</span>
                <span className="step-text">{plainAction(s)}</span>
                <span className={`step-res${r.ok ? '' : ' bad'}`}>{r.ok ? <Check size={14} aria-label="succeeded" /> : <><X size={14} aria-hidden /> {r.text}</>}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
