import { useState, type FormEvent } from 'react';
import { ArrowRight, Ear, Eye, Globe, Loader2, ShieldCheck, Syringe } from 'lucide-react';
import { createRun } from '../api.js';
import { navigate } from '../nav.js';

const DEMO_GOAL = 'Buy one 250 g bag of Ethiopia Guji coffee, whole bean. Ship to Ada Lovelace, Hauptstr. 1, 04109 Leipzig. Pay with card 4242 4242 4242 4242, expiry 12/28. Place the order.';

export function Home() {
  const [tab, setTab] = useState<'demo' | 'any'>('demo');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [code, setCode] = useState('');

  async function start(mode: 'demo' | 'drill' | 'any-url') {
    setBusy(mode);
    setError(null);
    try {
      const runId = await createRun(mode === 'any-url' ? { mode, url, goal, accessCode: code } : { mode });
      navigate(`/run/${runId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const submitAny = (e: FormEvent) => { e.preventDefault(); void start('any-url'); };

  return (
    <div className="home">
      <header className="topbar">
        <a className="wordmark" href="/">Earshot</a>
        <span className="topbar-note">Runs on Vultr Cloud Compute · Vultr Serverless Inference</span>
      </header>

      <main className="home-main">
        <section className="hero">
          <h1>Rules don’t fail customers. <em>Journeys do.</em></h1>
          <p className="lede">
            Two AI agents get the same shopping goal. One sees the screen. One gets only the accessibility tree, the way a screen-reader user does.
            Where the sighted agent gets through and the blind one stalls, Earshot names the element, the failure and the WCAG rule, then fixes it and proves the fix with a fresh blind run.
          </p>
        </section>

        <section className="launch" aria-label="Start a run">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'demo'} className={tab === 'demo' ? 'tab on' : 'tab'} onClick={() => setTab('demo')}>Demo store</button>
            <button role="tab" aria-selected={tab === 'any'} className={tab === 'any' ? 'tab on' : 'tab'} onClick={() => setTab('any')}><Globe size={16} aria-hidden /> Any URL <span className="beta">beta</span></button>
          </div>

          {tab === 'demo' ? (
            <div className="launch-body">
              <p className="goal"><span className="goal-label">Goal</span>{DEMO_GOAL}</p>
              <div className="launch-actions">
                <button className="btn primary" disabled={!!busy} onClick={() => void start('demo')}>
                  {busy === 'demo' ? <Loader2 className="spin" size={18} aria-hidden /> : <ArrowRight size={18} aria-hidden />} Run the demo
                </button>
                <button className="btn" disabled={!!busy} onClick={() => void start('drill')}>
                  {busy === 'drill' ? <Loader2 className="spin" size={18} aria-hidden /> : <Syringe size={18} aria-hidden />} Injection drill
                  <span className="btn-note">starts at checkout</span>
                </button>
              </div>
              <p className="fineprint">Kaffeebohne Roasters is a demo store we built with real accessibility bugs. Nothing is ever charged. Up to 3 runs per hour each.</p>
            </div>
          ) : (
            <form className="launch-body any" onSubmit={submitAny}>
              <label>Page URL<input type="url" required placeholder="https://shop.example.com" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
              <label>Goal<input required maxLength={500} placeholder="Find the returns policy" value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
              <label>Access code<input required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></label>
              <button className="btn primary" disabled={!!busy} type="submit">
                {busy === 'any-url' ? <Loader2 className="spin" size={18} aria-hidden /> : <ArrowRight size={18} aria-hidden />} Compare journeys
              </button>
              <p className="fineprint">Findings only: Earshot suggests patches for third-party sites but never changes them. Form submissions always wait for your approval.</p>
            </form>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>

        <section className="how" aria-label="How it works">
          <div className="how-row">
            <Eye className="c-sighted" size={22} aria-hidden />
            <p><strong>Sighted agent</strong> sees screenshots with numbered marks.</p>
          </div>
          <div className="how-row">
            <Ear className="c-blind" size={22} aria-hidden />
            <p><strong>Blind agent</strong> perceives only the accessibility tree. Same model, same prompt, different senses.</p>
          </div>
          <div className="how-row">
            <ShieldCheck className="c-ok" size={22} aria-hidden />
            <p><strong>Every action runs in a disposable gVisor sandbox</strong> with no secrets, capped memory and CPU, and one way out: an egress proxy that blocks everything else. The sandbox is destroyed after each run.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
