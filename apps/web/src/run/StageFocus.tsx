import { Loader2, Search, Wand2, Wrench } from 'lucide-react';
import { modePolicy, type AgentId, type Finding } from '@earshot/shared';
import { reruns, stageOf, type RunView } from '../reduce.js';
import { agentName, CATEGORY_LABEL } from '../labels.js';
import { CATEGORY_EXPLAIN, elementName, nextCheckpoint, reachedCount, WCAG_NAME } from '../narrative.js';
import { formatLeft } from '../ui/clock.js';
import { AgentIcon, toneOf } from './AgentIcon.js';
import { CheckTrack } from './CheckTrack.js';

/** What the live page puts in front: the two agents while they shop, otherwise one card for the current stage. */
export type Focus = 'screens' | 'checking' | 'decide' | 'patching' | 'verifying';

export function focusOf(view: RunView): Focus {
  switch (stageOf(view)) {
    case 'comparing': case 'inspecting': return 'checking';
    case 'awaiting-fix': return 'decide';
    case 'patching': return 'patching';
    case 'verifying': return 'verifying';
    default: return 'screens';
  }
}

/** The blocker the run is working on now: the one being fixed, else the first confirmed one still open. */
function currentFinding(view: RunView): Finding | undefined {
  const c = view.findings.filter((f) => f.confirmed);
  return c.find((f) => f.status === 'fixing') ?? c.find((f) => f.status === 'open') ?? c.at(-1);
}

const STEPS_CHECK = ['Repeat what the seeing agent did', 'Test that element like a screen reader: name, role, keyboard', 'Confirm the blocker, or drop it'];

/** One calm card that says what is happening, why, and (when it is the viewer's turn) what to do. */
export function StageFocus({ view, focus, isStarter, now, onFix }: { view: RunView; focus: Exclude<Focus, 'screens' | 'verifying'>; isStarter: boolean; now: number; onFix: () => void }) {
  const cps = modePolicy(view.meta?.mode);
  const f = currentFinding(view);

  if (focus === 'checking') {
    const fixing = view.phase === 'fixing';
    const who: AgentId = fixing ? reruns(view).at(-1) ?? 'blind' : 'blind';
    const cp = nextCheckpoint(view, who);
    const comparing = stageOf(view) === 'comparing';
    return (
      <section className="focus" aria-labelledby="focus-t" aria-busy="true">
        <span className="focus-icon"><Search size={20} aria-hidden /></span>
        <div className="focus-body">
          <p className="focus-step">{fixing ? 'The fix worked, so the blind agent got further' : 'Both agents are done'}</p>
          <h2 id="focus-t">{comparing ? 'Comparing how far each agent got' : `Checking why the blind agent got stuck${cp ? ` at ${cp}` : ''}`}</h2>
          {!comparing && (
            <ol className="focus-list">
              {STEPS_CHECK.map((s) => <li key={s}>{s}</li>)}
            </ol>
          )}
          <p className="focus-note"><Loader2 size={14} className="spin" aria-hidden /> Working in a fresh sandbox, so nothing from the first try carries over. Usually under a minute.</p>
        </div>
      </section>
    );
  }

  if (focus === 'patching') {
    return (
      <section className="focus" aria-labelledby="focus-t" aria-busy="true">
        <span className="focus-icon"><Wand2 size={20} aria-hidden /></span>
        <div className="focus-body">
          <p className="focus-step">Step 4 of 5</p>
          <h2 id="focus-t">Writing the fix{f ? ` for ${elementName(f.element.snippet)}` : ''}</h2>
          <p>AI on Vultr Serverless Inference picks attributes only, such as <code>role</code>, <code>aria-label</code> and <code>tabindex</code>. A fixed template applies them, so no generated code runs.</p>
          <p className="focus-note"><Loader2 size={14} className="spin" aria-hidden /> Usually a few seconds. Then a fresh blind agent tries again.</p>
        </div>
      </section>
    );
  }

  // decide: the run waits for the person who started it
  const cp = f ? cps.label(f.milestone) : undefined;
  const cat = f?.categories[0];
  const left = view.fixDeadlineAt ? formatLeft(view.fixDeadlineAt - now) : null;
  return (
    <section className="focus focus-decide" aria-labelledby="focus-t">
      <span className="focus-icon"><Wrench size={20} aria-hidden /></span>
      <div className="focus-body">
        <p className="focus-step">{isStarter ? 'Your turn' : 'Waiting for the person who started this run'}</p>
        <h2 id="focus-t">Earshot found what blocked the blind agent</h2>
        {f && (
          <div className="focus-finding">
            <p className="focus-finding-name">{elementName(f.element.snippet)} can’t be used without sight{cp ? <> · blocks <b>{cp}</b></> : null}</p>
            {cat && <p>{CATEGORY_LABEL[cat] ?? cat}: {CATEGORY_EXPLAIN[cat].wrong}</p>}
            <div className="finding-tags">{f.wcag.map((sc) => <span key={sc} className="tag">WCAG {sc} {WCAG_NAME[sc] ?? ''}</span>)}</div>
          </div>
        )}
        {isStarter ? (
          <div className="focus-actions">
            <button type="button" className="btn primary" onClick={onFix}><Wand2 size={16} aria-hidden /> Fix & verify</button>
            <p>Earshot writes a small attribute fix, then a fresh blind agent tries the whole journey again. About a minute.{left ? ` Available for ${left}.` : ''}</p>
          </div>
        ) : <p className="focus-note">Only the person who started this run can start Fix & verify{left ? ` (available for ${left})` : ''}.</p>}
      </div>
    </section>
  );
}

/** Beside the retry's live screen: what is being tested and how this try compares with the first one. */
export function VerifyCard({ view, rerun }: { view: RunView; rerun: AgentId }) {
  const policy = modePolicy(view.meta?.mode);
  const labels = policy.checkpoints.map((c) => c.label);
  const f = currentFinding(view);
  const cp = f ? policy.label(f.milestone) : nextCheckpoint(view, 'blind');
  const attempt = f ? (view.fixes[f.id]?.length ?? 0) + 1 : 1;
  // compare with the try just before this one: the first blind agent, or the previous retry in a later round
  const all = reruns(view);
  const before: AgentId = all.indexOf(rerun) > 0 ? all[all.indexOf(rerun) - 1]! : 'blind';
  const rows: { id: AgentId; label: string; live: boolean }[] = [
    { id: before, label: 'Before this fix', live: false },
    { id: rerun, label: 'With the fix, now', live: true },
  ];
  return (
    <section className="focus focus-side" aria-labelledby="verify-t">
      <div className="focus-body">
        <p className="focus-step">Step 5 of 5 · attempt {attempt} of 2</p>
        <h2 id="verify-t">Testing the fix</h2>
        <p>A fresh blind agent, with no memory of the first try, runs the whole journey with the fix applied. The fix counts only if it gets past <b>{cp ?? 'the blocked step'}</b>.</p>
        <div className="verify-rows">
          {rows.map((r) => {
            const reached = reachedCount(view, r.id);
            const a = view.agents[r.id];
            const failed = a?.outcome && a.outcome !== 'gate' && a.outcome !== 'done';
            return (
              <div key={r.id} className={`verify-row tone-${toneOf(r.id)}`}>
                <span className="verify-who"><AgentIcon id={r.id} size={14} />{r.label}</span>
                <CheckTrack labels={labels} reached={reached} stoppedAt={failed ? reached : undefined} here={r.live && !a?.outcome} tone={toneOf(r.id)} label={`${agentName(r.id)} checkpoints`} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
