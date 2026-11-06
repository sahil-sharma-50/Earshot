import { useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { modePolicy, wcagUrl, type AxNodeView, type Finding } from '@earshot/shared';
import { reruns, type RunView } from '../reduce.js';
import { CATEGORY_LABEL } from '../labels.js';
import { CATEGORY_EXPLAIN, elementName, nowLine, WCAG_NAME } from '../narrative.js';
import { ListenButton } from '../components/ListenButton.js';
import type { Selection } from './selection.js';

const ROWS = 6;

/** What a fresh blind agent heard around the same element once the fix was applied (null if no rerun reached it). */
export function afterExcerpt(view: RunView, f: Finding): AxNodeView[] | null {
  const names = new Set(f.evidence.blindExcerpt.map((n) => n.name).filter(Boolean));
  for (const id of reruns(view)) {
    const step = view.agents[id]?.steps.find((s) => s.milestones.includes(f.milestone) && s.axExcerpt);
    const nodes = step?.axExcerpt?.filter((n) => names.has(n.name));
    if (nodes?.length) return nodes.slice(0, ROWS);
  }
  return null;
}

function Readout({ nodes, label }: { nodes: AxNodeView[]; label: string }) {
  return (
    <ol className="reader-list" aria-label={label}>
      {nodes.slice(0, ROWS).map((n) => (
        <li key={n.ref} className={n.actionable ? 'is-act' : ''}>
          <code>{n.role}{n.name ? ` “${n.name.length > 48 ? n.name.slice(0, 47) + '…' : n.name}”` : ''}{n.states.length ? `, ${n.states.join(', ')}` : ''}</code>
          <span className={n.actionable ? 'reader-tag' : 'reader-tag is-bad'}>{n.actionable ? 'can use' : 'can’t use'}</span>
        </li>
      ))}
      {nodes.length === 0 && <li className="reader-more">Nothing was announced here.</li>}
    </ol>
  );
}

const STATUS: Record<Finding['status'], { text: string; cls: string }> = {
  open: { text: 'Blocks the purchase', cls: 'tag bad' },
  fixing: { text: 'Fix in progress', cls: 'tag accent' },
  verified: { text: 'Fixed and proven', cls: 'tag ok' },
  unverified: { text: 'Fix didn’t get through', cls: 'tag bad' },
};

function FindingCard({ runId, view, f, onOpen }: { runId: string; view: RunView; f: Finding; onOpen: (s: Selection) => void }) {
  const after = afterExcerpt(view, f);
  const fix = view.fixes[f.id]?.at(-1);
  const cp = modePolicy(view.meta?.mode).label(f.milestone);
  return (
    <article className="finding-card" aria-labelledby={`fc-${f.id}`}>
      <div className="finding-tags">
        <span className={STATUS[f.status].cls}>{STATUS[f.status].text}</span>
        {f.wcag.map((sc) => (
          <a key={sc} className="tag tag-link" href={wcagUrl(sc)} target="_blank" rel="noreferrer">WCAG {sc} {WCAG_NAME[sc] ?? ''}<ExternalLink size={11} aria-hidden /></a>
        ))}
      </div>
      <h3 id={`fc-${f.id}`}>{elementName(f.element.snippet)} can’t be used without sight</h3>
      <p className="finding-why">
        {f.categories.map((c) => `${CATEGORY_LABEL[c] ?? c}: ${CATEGORY_EXPLAIN[c].wrong}`).join(' ')} It blocks the step <b>{cp}</b>.
      </p>
      <div className="moment">
        <div className="moment-side">
          <p className="moment-label"><X size={14} aria-hidden className="bad-ico" />Before: what the blind agent heard</p>
          <Readout nodes={f.evidence.blindExcerpt} label="What the blind agent heard before the fix" />
        </div>
        <div className="moment-side">
          <p className="moment-label"><Check size={14} aria-hidden className="ok-ico" />{fix ? 'After: with the fix' : 'How to fix'}</p>
          {after ? <Readout nodes={after} label="What a fresh blind agent heard with the fix" />
            : fix ? (
              <ul className="attr-list">
                {Object.entries(fix.patch.attributes).map(([k, v]) => <li key={k}><code>{k}="{v}"</code></li>)}
                {fix.patch.keyboardShim && <li>Enter and Space activate it</li>}
              </ul>
            ) : <ul className="attr-list">{f.categories.map((c) => <li key={c}>{CATEGORY_EXPLAIN[c].fix}</li>)}</ul>}
        </div>
      </div>
      <div className="finding-foot">
        <ListenButton runId={runId} findingId={f.id} label="Listen to this spot" />
        <button type="button" className="btn small" onClick={() => onOpen({ kind: 'finding', id: f.id })}>Full evidence</button>
      </div>
    </article>
  );
}

/** Unified diff → display lines; the before/after file headers, hunk markers and "no newline" notes carry nothing here. */
function diffLines(diff: string): { text: string; kind: 'add' | 'del' | 'ctx' }[] {
  return diff.split('\n')
    .filter((l) => l !== '' && !/^(@@|---|\+\+\+|\\)/.test(l))
    .map((l) => ({ text: l, kind: l.startsWith('+') ? 'add' as const : l.startsWith('-') ? 'del' as const : 'ctx' as const }));
}

/** The patch Earshot wrote, as a real diff: one block per finding, newest attempt. */
function Patch({ view }: { view: RunView }) {
  const [copied, setCopied] = useState(false);
  const blocks = view.findings.filter((f) => f.confirmed && view.fixes[f.id]?.length).map((f) => ({ f, fix: view.fixes[f.id]!.at(-1)! }));
  if (!blocks.length) return null;
  const all = blocks.map((b) => b.fix.diff).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(all); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the diff stays selectable */ }
  };
  return (
    <section className="card patch" aria-labelledby="patch-title">
      <header className="patch-head">
        <div>
          <h2 id="patch-title" className="card-title">The patch</h2>
          <p className="card-sub">Only attributes such as role, aria-label and tabindex were added. No new code, and nothing removed.</p>
        </div>
        <button type="button" className="btn small" onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied ? 'Copied' : 'Copy patch'}</button>
        <span className="sr-only" role="status">{copied ? 'Patch copied' : ''}</span>
      </header>
      {blocks.map(({ f, fix }) => (
        <div key={f.id} className="patch-block">
          <p className="patch-for">{elementName(f.element.snippet)} · attempt {fix.attempt} · {fix.verified ? 'the blind rerun got past it' : 'the blind rerun was still blocked'}</p>
          <pre className="diff-view" tabIndex={0} aria-label={`Patch for ${elementName(f.element.snippet)}`}>
            {diffLines(fix.diff).map((l, i) => <span key={i} className={`dl-${l.kind}`}>{l.text}{'\n'}</span>)}
          </pre>
        </div>
      ))}
    </section>
  );
}

/** The finished run: one verdict, the blockers with before/after evidence, and the patch. */
export function Result({ runId, view, isStarter, onOpen }: { runId: string; view: RunView; isStarter: boolean; onOpen: (s: Selection) => void }) {
  const line = nowLine(view, isStarter, Date.now());
  const confirmed = view.findings.filter((f) => f.confirmed);
  const unconfirmed = view.findings.filter((f) => !f.confirmed);
  const fixed = view.finished?.verified && reruns(view).length > 0;
  const clean = view.finished?.verified && !reruns(view).length;
  const tag = view.stopped ? { t: 'Stopped', c: 'tag bad' } : view.finished?.error ? { t: 'Run error', c: 'tag bad' }
    : fixed ? { t: 'Fixed and proven', c: 'tag ok' } : clean ? { t: 'No blockers found', c: 'tag ok' } : { t: 'Blind agent blocked', c: 'tag bad' };
  const first = confirmed[0];
  const proven = confirmed.filter((f) => f.status === 'verified');
  const error = view.finished?.error;
  const headline = error
    ? proven.length
      ? `${proven.length === 1 ? 'One blocker was' : `${proven.length} blockers were`} fixed and proven, then the run stopped on an error.`
      : 'The run stopped early on an error.'
    : fixed && first
      ? `A blind customer couldn’t get past ${modePolicy(view.meta?.mode).label(first.milestone)}. Now they can.`
      : line.text;
  return (
    <div className="result">
      <header className="verdict">
        <span className={tag.c}>{tag.t}</span>
        <h1>{headline}</h1>
        {error
          ? <p>Everything below was recorded before it stopped. All sandboxes were still deleted. <span className="verdict-raw">{error}</span></p>
          : line.next && <p>{line.next}</p>}
      </header>
      {confirmed.map((f) => <FindingCard key={f.id} runId={runId} view={view} f={f} onOpen={onOpen} />)}
      {unconfirmed.length > 0 && (
        <ul className="minor-list" aria-label="Not counted">
          {unconfirmed.map((f) => (
            <li key={f.id}><span>{elementName(f.element.snippet)} · not confirmed by the inspector, so not counted</span><button type="button" className="link-btn" onClick={() => onOpen({ kind: 'finding', id: f.id })}>Details</button></li>
          ))}
        </ul>
      )}
      <Patch view={view} />
    </div>
  );
}
