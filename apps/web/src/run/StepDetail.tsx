import { useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import type { AgentId } from '@earshot/shared';
import type { RunView, StepEvent } from '../reduce.js';
import { actionText, agentName, MILESTONE_LABEL } from '../labels.js';
import { elementName, plainAction, plainResult } from '../narrative.js';
import { shotUrl } from '../api.js';
import { Dialog } from '../ui/Dialog.js';
import { AgentIcon } from './AgentIcon.js';
import type { Selection } from './selection.js';

function AxList({ step }: { step: StepEvent }) {
  const [all, setAll] = useState(false);
  const nodes = step.axExcerpt ?? [];
  const shown = all ? nodes : nodes.slice(0, 12);
  return (
    <>
      <ul className="ax-list">
        {shown.map((n) => (
          <li key={n.ref} className={n.actionable ? 'act' : ''}>
            <span className="ax-role">{n.role}</span>
            <span className="ax-name">{n.name ? `“${n.name.length > 80 ? n.name.slice(0, 79) + '…' : n.name}”` : <em>no name</em>}</span>
            {n.actionable ? <span className="ax-tag">can be used</span> : null}
            {n.states.length > 0 && <span className="ax-states">{n.states.join(', ')}</span>}
          </li>
        ))}
      </ul>
      {nodes.length > 12 && <button type="button" className="link-btn" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${nodes.length} items`}</button>}
    </>
  );
}

export function StepDetail({ runId, view, agent, index, onSelect }: { runId: string; view: RunView; agent: AgentId; index: number; onSelect: (s: Selection) => void }) {
  const steps = view.agents[agent]?.steps ?? [];
  const pos = steps.findIndex((s) => s.index === index);
  const step = steps[pos];
  const [zoom, setZoom] = useState<null | 1 | 2>(null);
  if (!step) return <p className="muted">This step is no longer available.</p>;
  const prev = steps[pos - 1];
  const next = steps[pos + 1];
  const r = plainResult(step);
  const before = steps[pos - 1]?.milestones.length ?? 0;
  const gained = step.milestones.slice(before);
  const go = (s?: StepEvent) => s && onSelect({ kind: 'step', agent, index: s.index });
  return (
    <div
      className="detail-step"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.key === 'ArrowLeft') go(prev);
        if (e.key === 'ArrowRight') go(next);
      }}
    >
      <header className="detail-head">
        <p className="detail-kicker"><AgentIcon id={agent} size={16} /> {agentName(agent)} · step {step.index + 1} of {steps.length}</p>
        <h2 tabIndex={-1} data-detail-heading>{plainAction(step)}</h2>
        <div className="pager">
          <button type="button" className="icon-btn" disabled={!prev} onClick={() => go(prev)} aria-label="Previous step"><ChevronLeft size={18} aria-hidden /></button>
          <button type="button" className="icon-btn" disabled={!next} onClick={() => go(next)} aria-label="Next step"><ChevronRight size={18} aria-hidden /></button>
        </div>
      </header>

      <dl className="facts">
        <div><dt>Result</dt><dd className={r.ok ? '' : 'bad'}>{r.text}{!r.ok && step.result.error && r.text !== step.result.error && <span className="mono raw">{step.result.error}</span>}</dd></div>
        <div><dt>Agent’s reasoning</dt><dd>{step.reasoning || <span className="muted">The model gave no reasoning for this step.</span>}</dd></div>
        <div><dt>Raw action</dt><dd className="mono">{actionText(step.action)}</dd></div>
        {step.result.element && (
          <div>
            <dt>{step.action.type === 'press' ? 'Focused element' : 'Element'}</dt>
            <dd>{elementName(step.result.element.snippet)}<details><summary>HTML</summary><pre className="code">{step.result.element.snippet}</pre></details></dd>
          </div>
        )}
        {gained.length > 0 && <div><dt>Checkpoint reached</dt><dd>{gained.map((m) => MILESTONE_LABEL[m]).join(', ')}</dd></div>}
        {step.url && <div><dt>Page</dt><dd className="mono url">{step.url}</dd></div>}
      </dl>

      {step.shotId && (
        <figure className="shot-fig">
          <figcaption>What the sighted agent saw. Its numbered marks are drawn into the screenshot.</figcaption>
          <button type="button" className="shot-btn" onClick={() => setZoom(1)} aria-label="Open screenshot larger">
            <img src={shotUrl(runId, step.shotId)} alt={`Screenshot the sighted agent saw at step ${step.index + 1}`} loading="lazy" />
            <span className="shot-zoom" aria-hidden><Maximize2 size={14} /></span>
          </button>
        </figure>
      )}
      {step.axExcerpt && (
        <section className="ax-block" aria-label="What the blind agent perceived">
          <h3>What the blind agent perceived</h3>
          <p className="muted small">The accessibility tree for this page, as a screen reader gets it. “Can be used” marks items it could operate.</p>
          <AxList step={step} />
        </section>
      )}

      {step.shotId && (
        <Dialog open={zoom !== null} title={`Step ${step.index + 1} screenshot`} onClose={() => setZoom(null)} variant="lightbox"
          actions={<button type="button" className="btn" onClick={() => setZoom(zoom === 2 ? 1 : 2)}>{zoom === 2 ? 'Fit to window' : 'Zoom 2×'}</button>}>
          <div className={`lightbox-img z${zoom ?? 1}`}><img src={shotUrl(runId, step.shotId)} alt={`Screenshot the sighted agent saw at step ${step.index + 1}`} /></div>
        </Dialog>
      )}
    </div>
  );
}
