import { useEffect, useReducer } from 'react';
import type { RunEvent } from '@earshot/shared';
import { emptyView, reduce, type RunView } from './reduce.js';

export { reduce, emptyView, type RunView } from './reduce.js';

type Msg = { type: 'reset' } | { type: 'event'; e: RunEvent } | { type: 'lost' };
interface State { view: RunView; connected: boolean; lost: boolean }

function step(s: State, m: Msg): State {
  if (m.type === 'reset') return { view: emptyView(), connected: true, lost: false };
  if (m.type === 'lost') return { ...s, connected: false, lost: true };
  return { ...s, view: reduce(s.view, m.e) };
}

/** Live run view. The server replays every event on (re)connect, so a reconnect starts from empty. */
export function useRunEvents(runId: string): State {
  const [state, dispatch] = useReducer(step, { view: emptyView(), connected: false, lost: false });
  useEffect(() => {
    let finished = false;
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onopen = () => dispatch({ type: 'reset' });
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      dispatch({ type: 'event', e });
      if (e.t === 'run.finished') { finished = true; es.close(); }
    };
    es.onerror = () => {
      if (finished) return;
      if (es.readyState === EventSource.CLOSED) dispatch({ type: 'lost' });
    };
    return () => es.close();
  }, [runId]);
  return state;
}
