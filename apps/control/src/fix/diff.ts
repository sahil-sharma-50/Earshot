import { createTwoFilesPatch } from 'diff';
import type { Patch } from '@earshot/shared';

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** What the element's opening tag looks like once the patch applies (for the human-readable diff). */
export function applyPatchToSnippet(snippet: string, patch: Patch): string {
  const end = snippet.indexOf('>');
  if (end < 0) return snippet;
  let open = snippet.slice(0, end);
  const selfClose = open.endsWith('/');
  if (selfClose) open = open.slice(0, -1).trimEnd();
  const text = snippet.slice(end + 1).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const set = (name: string, value: string) => {
    const re = new RegExp(`\\s${name.replace(/[-]/g, '\\-')}="[^"]*"`);
    const attr = ` ${name}="${escAttr(value)}"`;
    open = re.test(open) ? open.replace(re, attr) : open + attr;
  };
  for (const [k, v] of Object.entries(patch.attributes)) {
    if (v === undefined) continue;
    set(k, v === '$text' ? text : v === '$label' ? '(visible caption)' : v);
  }
  if (patch.keyboardShim) set('data-earshot-keyboard', 'Enter/Space→click');
  return open + (selfClose ? ' />' : '>') + snippet.slice(end + 1);
}

export function renderDiff(beforeSnippet: string, afterSnippet: string): string {
  return createTwoFilesPatch('before', 'after', beforeSnippet + '\n', afterSnippet + '\n', '', '', { context: 2 })
    .split('\n')
    .filter((l) => !l.startsWith('Index:') && !l.startsWith('====='))
    .join('\n');
}
