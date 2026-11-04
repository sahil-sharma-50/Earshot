import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { GLOSSARY } from '../narrative.js';
import { describeEvent } from './events.js';
import { FindingDetail } from './FindingDetail.js';
import { Overview } from './Overview.js';
import { StepDetail } from './StepDetail.js';
import type { Selection } from './selection.js';

export function DetailPanel({ runId, view, sel, follow, onSelect }: { runId: string; view: RunView; sel: Selection; follow: boolean; onSelect: (s: Selection) => void }) {
  const root = useRef<HTMLElement>(null);
  const key = JSON.stringify(sel);
  useEffect(() => {
    root.current?.scrollTo({ top: 0 });
    if (follow) return;
    root.current?.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  let body;
  if (sel.kind === 'step') body = <StepDetail runId={runId} view={view} agent={sel.agent} index={sel.index} onSelect={onSelect} />;
  else if (sel.kind === 'finding') body = <FindingDetail runId={runId} view={view} id={sel.id} onSelect={onSelect} />;
  else if (sel.kind === 'event') {
    const e = view.containment[sel.i];
    const d = e && describeEvent(e);
    body = d ? (
      <div>
        <header className="detail-head"><p className="detail-kicker">Safety event</p><h2 tabIndex={-1} data-detail-heading>{d.title}</h2></header>
        <p>{d.explain}</p>
        <pre className="code">{d.raw}</pre>
      </div>
    ) : <p className="muted">This event is no longer available.</p>;
  } else if (sel.kind === 'status') {
    body = (
      <div>
        <header className="detail-head"><p className="detail-kicker">What this means</p><h2 tabIndex={-1} data-detail-heading>{sel.title}</h2></header>
        <p>{GLOSSARY[sel.key] ?? 'No explanation available for this state.'}</p>
      </div>
    );
  } else body = <Overview view={view} sel={sel} onSelect={onSelect} />;

  return (
    <aside className="detail" aria-label="Details" ref={root}>
      {sel.kind !== 'overview' && (
        <button type="button" className="back-btn" onClick={() => onSelect({ kind: 'overview' })}><ArrowLeft size={16} aria-hidden /> Overview and safety</button>
      )}
      {body}
    </aside>
  );
}
