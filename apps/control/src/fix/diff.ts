import { createTwoFilesPatch } from 'diff';

/** A unified diff of an element's snippet before and after its patch (see `previewPatch`). */
export function renderDiff(beforeSnippet: string, afterSnippet: string): string {
  return createTwoFilesPatch('before', 'after', beforeSnippet + '\n', afterSnippet + '\n', '', '', { context: 2 })
    .split('\n')
    .filter((l) => !l.startsWith('Index:') && !l.startsWith('====='))
    .join('\n');
}
