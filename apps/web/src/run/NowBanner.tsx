import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, OctagonX, WifiOff } from 'lucide-react';
import type { NowLine } from '../narrative.js';

/** One plain sentence for what is happening and what comes next. Screen readers hear it at most every 3 s. */
export function NowBanner({ line, lost, finished, onAction }: { line: NowLine; lost: boolean; finished: boolean; onAction: (k: 'approval' | 'fix') => void }) {
  const text = lost ? 'Connection lost. Reload the page to catch up; the run continues on the server.' : line.text;
  const [spoken, setSpoken] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, 3000 - (Date.now() - last.current));
    const t = setTimeout(() => { last.current = Date.now(); setSpoken(text); }, wait);
    return () => clearTimeout(t);
  }, [text]);
  const needs = !lost && line.needsYou;
  return (
    <section className={`now${needs ? ' needs' : ''}${!lost && line.stopped ? ' stopped' : ''}`} aria-label="What is happening now">
      <span className="now-icon" aria-hidden>
        {lost ? <WifiOff size={18} /> : line.stopped ? <OctagonX size={18} /> : needs ? <CircleAlert size={18} /> : finished ? <CircleCheck size={18} /> : <span className="live-dot" />}
      </span>
      <div className="now-text">
        <p className="now-main">{text}</p>
        {!lost && line.next && <p className="now-next">{line.next}</p>}
      </div>
      {needs && (
        <button type="button" className="btn primary" onClick={() => onAction(line.needsYou!)}>
          {line.needsYou === 'approval' ? 'Review purchase' : 'Start Fix & verify'} <ArrowRight size={16} aria-hidden />
        </button>
      )}
      <p className="sr-only" aria-live="polite">{spoken}</p>
    </section>
  );
}
