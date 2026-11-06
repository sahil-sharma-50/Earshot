import { useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { modePolicy, wcagUrl, type AxNodeView, type Finding } from '@earshot/shared';
import { reruns, type RunView } from '../reduce.js';
import { CATEGORY_LABEL } from '../labels.js';
import { CATEGORY_EXPLAIN, elementName, nowLine, WCAG_NAME } from '../narrative.js';
import { ListenButton } from '../components/ListenButton.js';
import type { Selection } from './selection.js';

const ROWS = 6;

/** Each failure in a few words, for the one-line story. */
const SHORT: Record<string, string> = {
  'not-exposed': 'is hidden from screen readers',
  'no-name': 'has no name',
  'wrong-role': 'reads as plain text',
  'not-keyboard-operable': 'can’t be used by keyboard',
  'unlabeled-field': 'has no label',
};

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

/** The finished run: a short verdict, what to do next, three steps of what happened, then the evidence. */
export function Result({ runId, view, isStarter, onOpen, onLog }: { runId: string; view: RunView; isStarter: boolean; onOpen: (s: Selection) => void; onLog: () => void }) {
  const line = nowLine(view, isStarter, Date.now());
  const policy = modePolicy(view.meta?.mode);
  const confirmed = view.findings.filter((f) => f.confirmed);
  const unconfirmed = view.findings.filter((f) => !f.confirmed);
  const proven = confirmed.filter((f) => f.status === 'verified');
  const tried = reruns(view).length > 0;
  // a stop also arrives as an error string; it isn't a failure, so it reads as the stop it was
  const error = view.stopped ? undefined : view.finished?.error;
  const first = confirmed[0];
  const cp = first ? policy.label(first.milestone) : undefined;
  const fix = first ? view.fixes[first.id]?.at(-1) : undefined;

  let tag: { t: string; c: string };
  let title: string;
  let sub: string | undefined;
  if (view.stopped) {
    tag = { t: 'Stopped', c: 'tag' }; title = line.text; sub = 'Both agents were halted and every sandbox was deleted.';
  } else if (error) {
    tag = proven.length ? { t: 'Partly done', c: 'tag accent' } : { t: 'Stopped early', c: 'tag bad' };
    title = proven.length ? `Fixed ${proven.length === 1 ? 'one blocker' : `${proven.length} blockers`}. Then the run stopped early.` : 'This run stopped early.';
    sub = proven.length ? 'Earshot couldn’t finish checking the next step. The fix below is proven.' : 'Something failed on the server. Everything recorded so far is below.';
  } else if (view.finished?.verified && tried) {
    tag = { t: 'Fixed and proven', c: 'tag ok' };
    title = `Blind customers can now get all the way to “${policy.checkpoints.at(-1)!.label}”.`;
    sub = `${proven.length === 1 ? 'One blocker' : `${proven.length} blockers`} fixed and proven by a fresh blind agent.`;
  } else if (view.finished?.verified) {
    tag = { t: 'No blockers found', c: 'tag ok' }; title = 'Both agents got all the way through.'; sub = 'Nothing on this path blocks a screen-reader user.';
  } else {
    tag = { t: 'Blind agent blocked', c: 'tag bad' }; title = cp ? `A blind customer can’t get past ${cp}.` : 'The blind agent couldn’t finish.';
    sub = confirmed.length ? 'The blocker and how to fix it are below.' : undefined;
  }

  const [copied, setCopied] = useState(false);
  const diffs = confirmed.map((f) => view.fixes[f.id]?.at(-1)?.diff).filter(Boolean).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(diffs); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the diff stays selectable below */ }
  };

  return (
    <div className="result">
      <header className="verdict">
        <span className={tag.c}>{tag.t}</span>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
        <div className="verdict-actions">
          <a className="btn primary" href="/#start">Run another test</a>
          {diffs && <button type="button" className="btn" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{copied ? 'Copied' : 'Copy the patch'}</button>}
          <button type="button" className="btn" onClick={onLog}>Safety log</button>
          <span className="sr-only" role="status">{copied ? 'Patch copied' : ''}</span>
        </div>
        {error && <details className="verdict-raw"><summary>Technical details</summary><code>{error}</code></details>}
      </header>

      {first && (() => {
        const where = confirmed.map((f) => policy.label(f.milestone)).join(' and ');
        const fixed = confirmed.filter((f) => view.fixes[f.id]?.length);
        const all = proven.length === confirmed.length;
        return (
          <ol className="story" aria-label="What happened">
            <li className="is-bad"><span className="story-n">1</span><div><b>Blind agent got stuck</b><span>{confirmed.length === 1 ? `at ${cp}: ${elementName(first.element.snippet)} ${SHORT[first.categories[0] ?? ''] ?? 'can’t be used'}` : `${confirmed.length} times: at ${where}`}</span></div></li>
            <li className={fixed.length ? 'is-done' : ''}><span className="story-n">2</span><div><b>{fixed.length ? `Earshot wrote ${fixed.length === 1 ? 'a fix' : `${fixed.length} fixes`}` : 'No fix written'}</b><span>{fixed.length === 1 && fix ? Object.keys(fix.patch.attributes).join(', ') + (fix.patch.keyboardShim ? ' + keyboard' : '') : fixed.length ? 'attributes only, no new code' : view.stopped ? 'the run was stopped first' : 'Fix & verify was not started'}</span></div></li>
            <li className={proven.length && all ? 'is-done' : fixed.length ? 'is-bad' : ''}><span className="story-n">3</span><div><b>{proven.length ? (all ? 'Proven by a fresh blind agent' : `${proven.length} of ${confirmed.length} proven`) : fixed.length ? 'The retry was still blocked' : 'Not tested'}</b><span>{proven.length ? `it got past ${proven.map((f) => policy.label(f.milestone)).join(' and ')}` : fixed.length ? 'see the patch below' : 'nothing to test yet'}</span></div></li>
          </ol>
        );
      })()}

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
