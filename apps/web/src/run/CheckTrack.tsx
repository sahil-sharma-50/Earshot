/**
 * Checkpoints on one line: filled dots were reached, the ringed dot is where the agent is now, and a
 * crossed dot is where it stopped short of the goal.
 */
export function CheckTrack({ labels, reached, stoppedAt, here, tone, label }: {
  labels: readonly string[];
  reached: number;
  /** index of the checkpoint the agent stopped before, if it ended without reaching the goal */
  stoppedAt?: number;
  /** show a "you are here" ring on the next checkpoint (live agents) */
  here?: boolean;
  tone: 'sighted' | 'blind' | 'rerun';
  label: string;
}) {
  const n = labels.length;
  const fill = n > 1 ? Math.max(0, Math.min(reached, n) - 1) / (n - 1) : 0;
  return (
    <div className={`ck tone-${tone}`}>
      <span className="ck-fill" style={{ width: `calc((100% - 14px) * ${fill})` }} aria-hidden />
      <ol aria-label={label}>
      {labels.map((l, i) => {
        const state = i < reached ? 'hit' : i === stoppedAt ? 'stop' : here && i === reached ? 'here' : 'todo';
        return (
          <li key={l} className={`ck-${state}`}>
            <i aria-hidden />
            <span className="ck-label">{l}</span>
            <span className="sr-only">{state === 'hit' ? ': reached' : state === 'stop' ? ': stopped here' : state === 'here' ? ': working toward it' : ': not reached'}</span>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
