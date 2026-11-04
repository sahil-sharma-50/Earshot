import { useState } from 'react';
import { Eye, ListChecks, Route, ShieldCheck, X } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { cpus, gib } from '../labels.js';
import { GLOSSARY } from '../narrative.js';
import { Toggletip } from '../ui/Toggletip.js';
import { SafetyLog } from './SafetyLog.js';
import type { Selection } from './selection.js';

const INTRO_KEY = 'earshot:intro-dismissed';
const readIntro = () => { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; } };

export function Overview({ view, sel, onSelect }: { view: RunView; sel: Selection; onSelect: (s: Selection) => void }) {
  const [hidden, setHidden] = useState(readIntro);
  const dismiss = () => { setHidden(true); try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode */ } };
  const created = view.containment.filter((e) => e.t === 'sandbox.created');
  const destroyed = view.containment.filter((e) => e.t === 'sandbox.destroyed').length;
  const blocked = view.containment.filter((e) => e.t === 'containment.blocked').length;
  const flagged = view.containment.filter((e) => e.t === 'injection.flagged').length;
  const limits = created[0]?.t === 'sandbox.created' ? created[0].limits : undefined;
  return (
    <div className="overview">
      {!hidden && (
        <section className="intro" aria-labelledby="intro-title">
          <header>
            <h2 id="intro-title" tabIndex={-1} data-detail-heading>How to read this page</h2>
            <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss how to read this page"><X size={16} aria-hidden /></button>
          </header>
          <ol>
            <li><Eye size={16} aria-hidden /><span><strong>Two agents, one goal.</strong> The sighted agent sees screenshots. The blind agent hears only the accessibility tree, like a screen-reader user.</span></li>
            <li><Route size={16} aria-hidden /><span><strong>The journey</strong> shows how far each got. Where the blind row stops early is where a real customer would get stuck.</span></li>
            <li><ListChecks size={16} aria-hidden /><span><strong>Findings</strong> explain that point in plain words, with the evidence. You can fix and re-verify them.</span></li>
            <li><ShieldCheck size={16} aria-hidden /><span><strong>Safety</strong> logs every sandbox and every blocked request. Select any step, finding or event to see it here.</span></li>
          </ol>
        </section>
      )}
      <section aria-labelledby="safety-title" className="safety">
        <header className="section-head">
          <h2 id="safety-title" tabIndex={-1} data-detail-heading={hidden ? '' : undefined}>Safety</h2>
          <Toggletip label="About safety" align="end">{GLOSSARY.sandbox} {GLOSSARY['egress proxy']}</Toggletip>
        </header>
        <dl className="safety-stats">
          <div><dt>Sandboxes</dt><dd>{created.length} created · {created.length - destroyed} live</dd></div>
          <div><dt>Blocked requests</dt><dd className={blocked ? 'bad' : ''}>{blocked}</dd></div>
          <div><dt>Injection flags</dt><dd>{flagged}</dd></div>
          {limits && <div><dt>Limits per sandbox</dt><dd>{gib(limits.memoryBytes)} · {cpus(limits.nanoCpus)} · {limits.pidsLimit} processes · {Math.round(limits.timeoutMs / 1000)} s</dd></div>}
          <div><dt>Secrets inside</dt><dd>None. API keys stay in the control layer.</dd></div>
        </dl>
        <SafetyLog events={view.containment} sel={sel} onSelect={onSelect} />
      </section>
    </div>
  );
}

