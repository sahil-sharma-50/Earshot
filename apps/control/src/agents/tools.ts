import { PRESS_KEYS, type Action, type AgentKind, type PressKey } from '@earshot/shared';
import type { ToolDef } from '../inference/client.js';

const fn = (name: string, description: string, properties: Record<string, object>, required: string[]): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export function toolsFor(kind: AgentKind): ToolDef[] {
  const target = {
    type: 'string',
    description: kind === 'blind' ? 'The ref like a12 of an actionable node from the accessibility tree' : 'The mark number shown on the screenshot, like 7',
  };
  return [
    fn('click', 'Click / activate an element.', { target }, ['target']),
    fn('type', 'Type text into a text field (replaces its current value).', { target, text: { type: 'string' } }, ['target', 'text']),
    fn('select', 'Choose an option in a select / combo box.', { target, option: { type: 'string', description: 'The visible option text' } }, ['target', 'option']),
    fn('press', 'Press a keyboard key on the currently focused element.', { key: { type: 'string', enum: [...PRESS_KEYS] } }, ['key']),
    fn('scroll', 'Scroll the page.', { direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']),
    fn('navigate', 'Go to a URL.', { url: { type: 'string' } }, ['url']),
    fn('done', 'The goal is complete.', { reason: { type: 'string' } }, ['reason']),
    fn('stuck', 'You cannot make further progress toward the goal.', { reason: { type: 'string' } }, ['reason']),
  ];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

export function parseAction(toolName: string, args: unknown): Action | null {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const target = str(a.target);
  switch (toolName) {
    case 'click': return target ? { type: 'click', target } : null;
    case 'type': { const text = str(a.text); return target && text !== null ? { type: 'type', target, text } : null; }
    case 'select': { const option = str(a.option); return target && option ? { type: 'select', target, option } : null; }
    case 'press': return PRESS_KEYS.includes(a.key as PressKey) ? { type: 'press', key: a.key as PressKey } : null;
    case 'scroll': return a.direction === 'up' || a.direction === 'down' ? { type: 'scroll', direction: a.direction } : null;
    case 'navigate': { const url = str(a.url); return url ? { type: 'navigate', url } : null; }
    case 'done': return { type: 'done', reason: str(a.reason) ?? '' };
    case 'stuck': return { type: 'stuck', reason: str(a.reason) ?? '' };
    default: return null;
  }
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'click': return `click ${a.target}`;
    case 'type': return `type ${JSON.stringify(a.text)} into ${a.target}`;
    case 'select': return `select ${JSON.stringify(a.option)} in ${a.target}`;
    case 'press': return `press ${a.key}`;
    case 'scroll': return `scroll ${a.direction}`;
    case 'navigate': return `navigate to ${a.url}`;
    case 'done': return `done (${a.reason})`;
    case 'stuck': return `stuck (${a.reason})`;
  }
}
