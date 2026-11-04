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

        <section className="how" aria-labelledby="how-title">
          <h2 id="how-title">Same page, different senses.</h2>
          <p className="how-lede">Same model, same prompt. Only the input differs. This is the demo store’s grind picker:</p>
          <div className="specimen">
            <figure className="sense sense-sighted">
              <figcaption><Eye size={18} aria-hidden /> Sighted agent <span>screenshot with numbered marks</span></figcaption>
              <div className="swatches" aria-hidden>
                {['Whole bean', 'Espresso', 'Filter', 'French press'].map((g, i) => (
                  <span key={g} className={i === 0 ? 'sw on' : 'sw'}><b>{i + 4}</b>{g}</span>
                ))}
              </div>
            </figure>
            <figure className="sense sense-blind">
              <figcaption><Ear size={18} aria-hidden /> Blind agent <span>accessibility tree only</span></figcaption>
              <pre className="mono">{['Whole bean', 'Espresso', 'Filter', 'French press'].map((g) => `StaticText “${g}”  · not actionable\n`).join('')}</pre>
            </figure>
          </div>
        </section>

        <section className="flow" aria-labelledby="flow-title">
          <h2 id="flow-title">What happens when you press Run</h2>
          <ol className="flow-steps">
            <li><span className="flow-n">1</span><div><h3>Two agents run in sandboxes</h3><p>Both get the same goal and the same model on Vultr Serverless Inference. Each drives a real browser in its own gVisor sandbox on a Vultr Cloud Compute VM.</p></div></li>
            <li><span className="flow-n">2</span><div><h3>Compare and confirm</h3><p>Earshot finds the first checkpoint the sighted agent passed and the blind agent did not. A fresh inspector sandbox checks the element’s role, name, keyboard access and label.</p></div></li>
            <li><span className="flow-n">3</span><div><h3>Fix</h3><p>When you ask, the model writes an attribute-only patch. A fixed template applies it; no generated code runs.</p></div></li>
            <li><span className="flow-n">4</span><div><h3>Verify</h3><p>A fresh blind agent reruns the journey with the patch. The fix only counts if it gets past the blocked checkpoint.</p></div></li>
          </ol>
          <p className="flow-note">You can pause or stop a run you started, and every purchase waits for your approval.</p>
        </section>

        <section className="contained" aria-labelledby="contained-title">
          <h2 id="contained-title"><ShieldCheck size={22} aria-hidden /> Contained by design</h2>
          <ul>
            <li><strong>Isolated.</strong> Each agent runs in its own gVisor container, never on the host.</li>
            <li><strong>No secrets inside.</strong> API keys stay in the control layer.</li>
            <li><strong>Capped.</strong> Memory, CPU, process count and a hard time limit on every sandbox.</li>
            <li><strong>One way out.</strong> An egress proxy allows only the hosts a run needs and logs everything it blocks.</li>
            <li><strong>Disposable.</strong> Every sandbox is destroyed when its agent finishes.</li>
          </ul>
        </section>
      </main>
      <footer className="home-foot">Runs on Vultr Cloud Compute · Vultr Serverless Inference</footer>
    </div>
  );
}
