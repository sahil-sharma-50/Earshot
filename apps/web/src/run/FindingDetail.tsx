import { Check, CircleDashed, ExternalLink, X } from 'lucide-react';
import { modePolicy, wcagUrl } from '@earshot/shared';
import type { RunView } from '../reduce.js';
import { CATEGORY_LABEL } from '../labels.js';
import { CATEGORY_EXPLAIN, elementName, findingTitle, WCAG_NAME } from '../narrative.js';
import { shotUrl } from '../api.js';
import { ListenButton } from '../components/ListenButton.js';
import type { Selection } from './selection.js';

const AXE_URL = (id: string) => `https://dequeuniversity.com/rules/axe/4.10/${id}`;

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="code diff">
      {diff.split('\n').filter((l) => !/^(---|\+\+\+|@@)/.test(l) && l !== '').map((l, i) => (
        <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l}{'\n'}</span>
      ))}
    </pre>
  );
}

export function FindingDetail({ runId, view, id, onSelect }: { runId: string; view: RunView; id: string; onSelect: (s: Selection) => void }) {
  const f = view.findings.find((x) => x.id === id);
  if (!f) return <p className="muted">This finding is no longer available.</p>;
  const cp = modePolicy(view.meta?.mode).label(f.milestone);
  const name = elementName(f.element.snippet);
  const sighted = view.agents.sighted?.steps.find((s) => s.index === f.evidence.sightedStep);
  const fixes = view.fixes[f.id] ?? [];
  const last = fixes.at(-1);
  const timeline: { label: string; state: 'done' | 'bad' | 'todo' }[] = [
    { label: 'Found: the journeys diverged here', state: 'done' },
    { label: f.confirmed ? 'Confirmed by the inspector sandbox' : 'Not confirmed by the inspector', state: f.confirmed ? 'done' : 'bad' },
    { label: last ? `Fix proposed (attempt ${last.attempt})` : 'Fix proposed', state: last ? 'done' : 'todo' },
    { label: f.status === 'verified' ? 'Verified: the blind rerun got past it' : f.status === 'unverified' ? 'Not verified: the rerun was still blocked' : 'Verified by a blind rerun', state: f.status === 'verified' ? 'done' : f.status === 'unverified' ? 'bad' : 'todo' },
  ];
  return (
    <div className="detail-finding">
      <header className="detail-head">
        <p className="detail-kicker">{f.confirmed ? 'Confirmed finding' : 'Not confirmed'} · {cp}</p>
        <h2 tabIndex={-1} data-detail-heading>{findingTitle(f, view.meta?.mode)}</h2>
      </header>

      {!f.confirmed && <p className="note">The inspector could not confirm a defect on this element, so it isn’t counted. It is shown for transparency.</p>}

      <section>
        <h3>What’s wrong</h3>
        <ul className="plain-list">{f.categories.map((c) => <li key={c}><strong>{CATEGORY_LABEL[c] ?? c}.</strong> {CATEGORY_EXPLAIN[c].wrong}</li>)}</ul>
      </section>

      <section className="compare">
        <div>
          <h3>Sighted agent</h3>
          {sighted ? <p>Saw {name} and used it at step {sighted.index + 1}, then moved on. <button type="button" className="link-btn" onClick={() => onSelect({ kind: 'step', agent: 'sighted', index: sighted.index })}>Open step {sighted.index + 1}</button></p> : <p>Passed this point without trouble.</p>}
          {sighted?.shotId && <img className="thumb" src={shotUrl(runId, sighted.shotId)} alt={`What the sighted agent saw at step ${sighted.index + 1}`} loading="lazy" />}
        </div>
        <div>
          <h3>Blind agent</h3>
          <p>Perceived only this, and could not continue. <button type="button" className="link-btn" onClick={() => onSelect({ kind: 'step', agent: 'blind', index: f.evidence.blindLastStep })}>Open its last step</button></p>
          <ul className="ax-list">
            {f.evidence.blindExcerpt.slice(0, 8).map((n) => (
              <li key={n.ref} className={n.actionable ? 'act' : ''}>
                <span className="ax-role">{n.role}</span>
                <span className="ax-name">{n.name ? `“${n.name}”` : <em>no name</em>}</span>
                <span className="ax-tag">{n.actionable ? 'can be used' : 'can’t be used'}</span>
              </li>
            ))}
            {f.evidence.blindExcerpt.length === 0 && <li className="muted">Nothing in this region.</li>}
          </ul>
          <ListenButton runId={runId} findingId={f.id} label="Listen to this region" />
        </div>
      </section>

      <section>
        <h3>Why it matters</h3>
        <ul className="plain-list">{f.categories.map((c) => <li key={c}>{CATEGORY_EXPLAIN[c].impact}</li>)}</ul>
        <p className="muted small">A customer who relies on a screen reader cannot get past {cp}, so they cannot buy.</p>
      </section>

      <section>
        <h3>Guidelines</h3>
        <ul className="rule-list">
          {f.wcag.map((sc) => <li key={sc}><a href={wcagUrl(sc)} target="_blank" rel="noreferrer">WCAG {sc} {WCAG_NAME[sc] ?? ''} <ExternalLink size={12} aria-hidden /></a></li>)}
          {f.axeRules.map((r) => <li key={r}><a href={AXE_URL(r)} target="_blank" rel="noreferrer" className="mono">axe: {r} <ExternalLink size={12} aria-hidden /></a></li>)}
        </ul>
      </section>

      <section>
        <h3>How to fix</h3>
        {last ? (
          <>
            <p>Earshot’s patch, attempt {last.attempt}. {last.verified ? 'The blind rerun got past this checkpoint with it.' : 'The blind rerun was still blocked with it.'}</p>
            <ul className="plain-list">
              {Object.entries(last.patch.attributes).map(([k, v]) => <li key={k}><span className="mono">{k}="{v}"</span></li>)}
              {last.patch.keyboardShim && <li>Enter and Space activate the element</li>}
            </ul>
            <details><summary>Diff</summary><Diff diff={last.diff} /></details>
          </>
        ) : (
          <ul className="plain-list">{f.categories.map((c) => <li key={c}>{CATEGORY_EXPLAIN[c].fix}</li>)}</ul>
        )}
      </section>

      <section>
        <h3>Status</h3>
        <ol className="timeline">
          {timeline.map((t) => (
            <li key={t.label} className={t.state}>
              <span className="tl-mark" aria-hidden>{t.state === 'done' ? <Check size={12} strokeWidth={3} /> : t.state === 'bad' ? <X size={12} strokeWidth={3} /> : <CircleDashed size={12} />}</span>
              {t.label}
            </li>
          ))}
        </ol>
      </section>

      <details className="evidence">
        <summary>Technical evidence</summary>
        <dl className="facts">
          <div><dt>Element HTML</dt><dd><pre className="code">{f.element.snippet}</pre></dd></div>
          <div><dt>CSS path</dt><dd className="mono">{f.element.cssPath}</dd></div>
          <div><dt>Failure categories</dt><dd className="mono">{f.categories.join(', ')}</dd></div>
        </dl>
      </details>
    </div>
  );
}
