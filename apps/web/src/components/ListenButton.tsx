import { useRef, useState } from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import type { AgentId } from '@earshot/shared';
import { listen } from '../api.js';

/** Plays a TTS screen-reader readout (Vultr Serverless Inference) and shows the spoken script as captions. */
export function ListenButton({ runId, agent, findingId, label = 'Listen' }: { runId: string; agent?: AgentId; findingId?: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  async function play() {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    setError(null);
    try {
      const r = await listen(runId, { agent, findingId });
      setScript(r.script);
      const a = audio.current ?? new Audio();
      audio.current = a;
      a.src = r.audioUrl;
      a.onended = () => setState('idle');
      await a.play();
      setState('playing');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  return (
    <div className="listen">
      <button className="btn listen-btn" onClick={() => void play()} disabled={state === 'loading'} aria-pressed={state === 'playing'}>
        {state === 'loading' ? <Loader2 className="spin" size={16} aria-hidden /> : state === 'playing' ? <Square size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
        {state === 'playing' ? 'Stop' : label}
      </button>
      {script && <p className="captions" aria-live="polite">{script}</p>}
      {error && <p className="form-error inline" role="alert">{error}</p>}
    </div>
  );
}
