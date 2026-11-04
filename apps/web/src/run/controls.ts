import { isPausableAgent, type AgentId } from '@earshot/shared';
import { isPaused, type RunView } from '../reduce.js';

export interface Controls { pause: boolean; resume: boolean; stop: boolean; note?: string }

/** Which run controls the viewer may use right now. Only the starter controls a run. */
export function controlsFor(view: RunView, isStarter: boolean, now: number): Controls {
  if (!isStarter) return { pause: false, resume: false, stop: false, note: 'Watching. Only the person who started this run can control it.' };
  if (view.finished) return { pause: false, resume: false, stop: false };
  const paused = isPaused(view, now);
  const live = Object.entries(view.agents).some(([id, a]) => isPausableAgent(id as AgentId) && a?.sandbox && !a.sandbox.destroyed);
  const pausable = (view.phase === 'running' || view.phase === 'fixing') && live;
  return { pause: !paused && pausable, resume: paused, stop: true };
}
