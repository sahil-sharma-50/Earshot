import type { Action, AgentId, AgentOutcome } from '@earshot/shared';

export const OUTCOME_LABEL: Record<AgentOutcome, string> = {
  gate: 'Reached Place order',
  done: 'Finished',
  stuck: 'Gave up: stuck',
  timeout: 'Out of time',
  'max-steps': 'Out of steps',
  'no-progress': 'Stalled',
  error: 'Run error',
  stopped: 'Stopped',
};

export function agentName(id: AgentId): string {
  if (id === 'sighted') return 'Sighted';
  if (id === 'blind') return 'Blind';
  if (id === 'inspector') return 'Inspector';
  return `Rerun ${id.slice(6)}`;
}

export function actionText(a: Action): string {
  switch (a.type) {
    case 'click': return `click ${a.target}`;
    case 'type': return `type “${a.text}” → ${a.target}`;
    case 'select': return `select “${a.option}” → ${a.target}`;
    case 'press': return `press ${a.key}`;
    case 'scroll': return `scroll ${a.direction}`;
    case 'navigate': return `go to ${a.url}`;
    case 'done': return 'done';
    case 'stuck': return 'stuck';
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  'not-exposed': 'Not exposed',
  'no-name': 'No accessible name',
  'wrong-role': 'Wrong role',
  'not-keyboard-operable': 'Not keyboard operable',
  'unlabeled-field': 'Unlabeled field',
};

export const shortId = (id: string) => id.slice(0, 12);
export const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 ? 1 : 0)} GiB`;
export const cpus = (nano: number) => `${(nano / 1e9).toFixed(2).replace(/0$/, '')} CPU`;
