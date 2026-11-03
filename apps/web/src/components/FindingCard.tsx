import { CircleCheck, CircleDashed, CircleX, ExternalLink, Loader2 } from 'lucide-react';
import { wcagUrl, type Finding, type MilestoneId } from '@earshot/shared';
import type { FixAttempt, StepEvent } from '../reduce.js';
import { CATEGORY_LABEL, MILESTONE_LABEL } from '../labels.js';
import { ListenButton } from './ListenButton.js';

/** What a sighted person would call the element: its visible text, or its tag. */
function visibleText(snippet: string): string {
  const text = snippet.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text) return `“${text.length > 40 ? text.slice(0, 39) + '…' : text}”`;
  const tag = /^<([a-z0-9-]+)/i.exec(snippet)?.[1] ?? 'element';
  return `the unlabeled ${tag}`;
}

function verb(step: StepEvent): string {
  return step.action.type === 'type' ? 'typed into' : step.action.type === 'select' ? 'chose from' : 'clicked';
}

const AXE_URL = (id: string) => `https://dequeuniversity.com/rules/axe/4.10/${id}`;

function Badge({ f }: { f: Finding }) {
  if (!f.confirmed) return <span className="badge muted"><CircleDashed size={14} aria-hidden /> Inconclusive (agent error)</span>;
  switch (f.status) {
    case 'verified': return <span className="badge good"><CircleCheck size={14} aria-hidden /> Fix verified</span>;
    case 'unverified': return <span className="badge bad"><CircleX size={14} aria-hidden /> Fix not verified</span>;
    case 'fixing': return <span className="badge live"><Loader2 className="spin" size={14} aria-hidden /> Fixing</span>;
    default: return <span className="badge bad">Blocks the journey</span>;
  }
}

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="diff mono">
      {diff.split('\n').filter((l) => !/^(---|\+\+\+|@@)/.test(l) && l !== '').map((l, i) => (
        <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l}{'\n'}</span>
      ))}
    </pre>
  );
}

export function FindingCard({ runId, finding, fixes, sightedStep }: { runId: string; finding: Finding; fixes: FixAttempt[]; sightedStep?: StepEvent }) {
  const last = fixes.at(-1);
  const milestone = MILESTONE_LABEL[finding.milestone as MilestoneId] ?? finding.milestone;
  return (
    <article className={`finding${finding.confirmed ? '' : ' inconclusive'}`}>
      <header className="finding-head">
        <h3>Blocks “{milestone}”</h3>
        <Badge f={finding} />
      </header>

      <pre className="snippet mono">{finding.element.snippet}</pre>

      {finding.categories.length > 0 && (
        <ul className="chips" aria-label="Failure categories">
          {finding.categories.map((c) => <li key={c}>{CATEGORY_LABEL[c] ?? c}</li>)}
        </ul>
      )}

      <p className="rules">
        {finding.axeRules.map((r) => <a key={r} href={AXE_URL(r)} target="_blank" rel="noreferrer" className="mono">{r}</a>)}
        {finding.axeRules.length > 0 && <span className="arrow" aria-hidden>→</span>}
        {finding.wcag.map((sc) => <a key={sc} href={wcagUrl(sc)} target="_blank" rel="noreferrer">WCAG {sc} <ExternalLink size={12} aria-hidden /></a>)}
      </p>

      <div className="evidence">
        <p><span className="c-sighted">Sighted</span> {sightedStep ? <>{verb(sightedStep)} <strong>{visibleText(finding.element.snippet)}</strong> at step {finding.evidence.sightedStep + 1} and moved on.</> : <>passed this step.</>}</p>
        <p><span className="c-blind">Blind</span> perceived only:</p>
        <pre className="ax-mini mono">
          {finding.evidence.blindExcerpt.slice(0, 8).map((n) => `${n.role} ${n.name ? `“${n.name.length > 60 ? n.name.slice(0, 59) + '…' : n.name}”` : '(no name)'}${n.actionable ? '' : '  · not actionable'}`).join('\n') || '(nothing in this region)'}
        </pre>
      </div>

      <ListenButton runId={runId} findingId={finding.id} label="Listen to this region" />

      {last && (
        <div className="fix">
          <p className="fix-head">
            {last.verified ? <CircleCheck size={16} className="c-ok" aria-hidden /> : <CircleX size={16} className="c-bad" aria-hidden />}
            Patch attempt {last.attempt}: {last.verified ? 'blind rerun passed this step' : 'blind rerun still blocked'}
          </p>
          <Diff diff={last.diff} />
        </div>
      )}
    </article>
  );
}
