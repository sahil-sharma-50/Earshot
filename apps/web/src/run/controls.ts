import { isPaused, type RunView } from '../reduce.js';

export interface Controls { pause: boolean; resume: boolean; stop: boolean; note?: string }

/** Which run controls the viewer may use right now. Only the starter controls a run. */
export function controlsFor(view: RunView, isStarter: boolean, now: number): Controls {
  if (!isStarter) return { pause: false, resume: false, stop: false, note: 'Watching. Only the person who started this run can control it.' };
  if (view.finished) return { pause: false, resume: false, stop: false };
  const paused = isPaused(view, now);
  const live = Object.values(view.agents).some((a) => a?.sandbox && !a.sandbox.destroyed);
  const pausable = (view.phase === 'running' || view.phase === 'fixing') && live;
  return { pause: !paused && pausable, resume: paused, stop: true };
}
