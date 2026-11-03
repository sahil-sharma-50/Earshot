import { useEffect, useRef, useState } from 'react';
import { Box, Check, Ear, Eye, Loader2, Wrench, X } from 'lucide-react';
import type { AgentId } from '@earshot/shared';
import type { AgentView, StepEvent } from '../reduce.js';
import { MilestoneBar } from './MilestoneBar.js';
import { actionText, agentName, cpus, gib, OUTCOME_LABEL, shortId } from '../labels.js';
import { shotUrl } from '../api.js';

function Sandbox({ view }: { view: AgentView }) {
  const sb = view.sandbox;
  if (!sb) return <p className="sb-line muted"><Loader2 className="spin" size={14} aria-hidden /> waiting for a sandbox</p>;
  return (
    <p className={`sb-line${sb.destroyed ? ' gone' : ''}`}>
      <Box size={14} aria-hidden />
      <span className="mono">{shortId(sb.id)}</span>
      <span>{sb.limits.runtime}</span>
      <span>{gib(sb.limits.memoryBytes)}</span>
      <span>{cpus(sb.limits.nanoCpus)}</span>
      <span>{sb.limits.pidsLimit} pids</span>
      {sb.destroyed && <span className="destroyed">destroyed</span>}
    </p>
  );
}

function AxExcerpt({ step }: { step: StepEvent }) {
  const [open, setOpen] = useState(false);
  const nodes = step.axExcerpt ?? [];
  const shown = open ? nodes : nodes.slice(0, 7);
  return (
    <div className="ax">
      <pre className="mono">
        {shown.map((n) => (
          <span key={n.ref} className={n.actionable ? 'ax-act' : 'ax-text'}>
            {n.role} {n.name ? `“${n.name.length > 70 ? n.name.slice(0, 69) + '…' : n.name}”` : '(no name)'}{n.states.length ? `  ${n.states.join(', ')}` : ''}{'\n'}
          </span>
        ))}
      </pre>
      {nodes.length > 7 && <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show all ${nodes.length} nodes`}</button>}
    </div>
  );
}

function StepCard({ runId, step }: { runId: string; step: StepEvent }) {
  const failed = !step.result.ok;
  return (
    <li className={`step${failed ? ' failed' : ''}`}>
      <div className="step-head">
        <span className="step-n">{step.index + 1}</span>
        <span className="step-action mono">{actionText(step.action)}</span>
        {failed
          ? <span className="step-res bad"><X size={14} aria-hidden /> {step.result.error}</span>
          : <span className="step-res ok"><Check size={14} aria-hidden /></span>}
      </div>
      {step.reasoning && <p className="step-why">{step.reasoning}</p>}
      {step.shotId && <img className="shot" src={shotUrl(runId, step.shotId)} alt={`What the sighted agent saw at step ${step.index + 1}`} loading="lazy" />}
      {step.axExcerpt && <AxExcerpt step={step} />}
    </li>
  );
}

export function AgentColumn({ runId, id, view }: { runId: string; id: AgentId; view: AgentView | undefined }) {
  const v = view ?? { steps: [], milestones: [] };
  const tone = id === 'sighted' ? 'sighted' : id === 'blind' ? 'blind' : 'rerun';
  const Icon = id === 'sighted' ? Eye : id === 'blind' ? Ear : Wrench;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [v.steps.length]);
  const running = !v.outcome && !!v.sandbox && !v.sandbox.destroyed;
  return (
    <section className={`col tone-${tone}`} aria-label={`${agentName(id)} agent`}>
      <header className="col-head">
        <h2><Icon size={20} aria-hidden /> {agentName(id)}{id === 'blind' && <span className="col-sub">accessibility tree only</span>}{id === 'sighted' && <span className="col-sub">screenshots</span>}{tone === 'rerun' && <span className="col-sub">blind + fixes</span>}</h2>
        {v.outcome
          ? <span className={`outcome ${v.outcome === 'gate' || v.outcome === 'done' ? 'good' : 'bad'}`}>{OUTCOME_LABEL[v.outcome]}</span>
          : running ? <span className="outcome live"><span className="pulse" aria-hidden /> step {v.steps.length + 1}</span> : null}
      </header>
      <MilestoneBar reached={v.milestones} tone={tone} />
      <Sandbox view={v} />
      <ol className="steps" ref={list}>
        {[...v.steps].reverse().map((s) => <StepCard key={`${s.index}-${s.action.type}`} runId={runId} step={s} />)}
        {v.steps.length === 0 && <li className="empty">No steps yet.</li>}
      </ol>
    </section>
  );
}
