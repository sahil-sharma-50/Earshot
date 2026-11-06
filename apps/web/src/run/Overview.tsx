import { ArrowDown, Box, Globe, Server } from 'lucide-react';
import type { RunView } from '../reduce.js';
import { cpus, gib } from '../labels.js';
import { GLOSSARY } from '../narrative.js';
import { Toggletip } from '../ui/Toggletip.js';
import { SafetyLog } from './SafetyLog.js';
import { hostOf } from './Brief.js';
import type { Selection } from './selection.js';
import { useId } from 'react';

/** How the agents do real work, and the evidence that it stayed contained. Always visible when nothing is selected. */
export function Overview({ view, sel, onSelect }: { view: RunView; sel: Selection; onSelect: (s: Selection) => void }) {
  const created = view.containment.filter((e) => e.t === 'sandbox.created');
  const destroyed = view.containment.filter((e) => e.t === 'sandbox.destroyed').length;
  const blocked = view.containment.filter((e) => e.t === 'containment.blocked').length;
  const flagged = view.containment.filter((e) => e.t === 'injection.flagged').length;
  const limits = created[0]?.t === 'sandbox.created' ? created[0].limits : undefined;
  const live = created.length - destroyed;
  const site = view.meta ? hostOf(view.meta.target) : 'The website';
  return (
    <div className="overview">
      <WorkFlow site={site} heading />

      <section aria-labelledby="safety-title" className="safety">
        <header className="section-head">
          <h2 id="safety-title">Safety checks</h2>
          <Toggletip label="About safety" align="end">{GLOSSARY.sandbox} {GLOSSARY['egress proxy']}</Toggletip>
        </header>
        <dl className="safety-stats">
          <div><dt>Sandboxes</dt><dd>{created.length} started · {live > 0 ? `${live} still running` : created.length ? 'all deleted' : 'none yet'}</dd></div>
          <div><dt>Blocked requests</dt><dd className={blocked ? 'bad' : ''}>{blocked === 0 ? 'None' : blocked}</dd></div>
          <div><dt>Secret keys inside sandboxes</dt><dd>None</dd></div>
          <div><dt>Hidden instructions spotted</dt><dd>{flagged === 0 ? 'None' : flagged}</dd></div>
          {limits && <div><dt>Limits for every sandbox</dt><dd>{gib(limits.memoryBytes)} memory · {cpus(limits.nanoCpus)} · {limits.pidsLimit} processes · stopped after {Math.round(limits.timeoutMs / 1000)} s</dd></div>}
        </dl>
        <h3 className="sub-head">Safety log</h3>
        <SafetyLog events={view.containment} mode={view.meta?.mode} sel={sel} onSelect={onSelect} />
      </section>
    </div>
  );
}

/** How the agents do real work: server plans, a sandbox acts in a real browser, the site responds. */
export function WorkFlow({ site, heading = false }: { site: string; heading?: boolean }) {
  const id = useId();
  return (
    <section className="flow-wrap" aria-labelledby={id}>
      <h2 id={id} tabIndex={-1} data-detail-heading={heading ? '' : undefined}>Where the work happens</h2>
      <p className="section-sub">The agents don’t just chat. They click and type in real browsers, each locked in its own box.</p>
      <ol className="flow">
        <li className="flow-node">
          <Server size={18} aria-hidden />
          <div><strong>Earshot server on Vultr</strong><p>Decides each next step using an AI model on Vultr Serverless Inference. The secret API keys stay here.</p></div>
        </li>
        <li className="flow-link"><ArrowDown size={14} aria-hidden /> sends one action: click, type, scroll</li>
        <li className="flow-node strong">
          <Box size={18} aria-hidden />
          <div><strong>A sandbox for each agent</strong><p>A sealed, throwaway box running a real Chrome browser. No keys inside, strict limits, deleted when the agent is done.</p></div>
        </li>
        <li className="flow-link"><ArrowDown size={14} aria-hidden /> only through a gate with an allow list; all else is blocked</li>
        <li className="flow-node">
          <Globe size={18} aria-hidden />
          <div><strong>{site}</strong><p>The real page loads and reacts. What changed goes back up to the server for the next step.</p></div>
        </li>
      </ol>
    </section>
  );
}
