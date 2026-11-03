import type { FailureCategory } from './types.js';

export const CATEGORY_RULES: Record<FailureCategory, { axe: string[]; wcag: string[] }> = {
  'not-exposed': { axe: [], wcag: ['4.1.2'] },
  'no-name': { axe: ['button-name', 'link-name', 'aria-command-name'], wcag: ['4.1.2'] },
  'wrong-role': { axe: ['aria-command-name'], wcag: ['4.1.2'] },
  'not-keyboard-operable': { axe: [], wcag: ['2.1.1'] },
  'unlabeled-field': { axe: ['label'], wcag: ['1.3.1', '4.1.2'] },
};

/** WCAG 2.2 Understanding-doc slugs for the success criteria Earshot reports. */
export const WCAG_SLUGS: Record<string, string> = {
  '1.1.1': 'non-text-content',
  '1.3.1': 'info-and-relationships',
  '1.3.2': 'meaningful-sequence',
  '2.1.1': 'keyboard',
  '2.4.3': 'focus-order',
  '2.4.4': 'link-purpose-in-context',
  '2.4.6': 'headings-and-labels',
  '3.3.2': 'labels-or-instructions',
  '4.1.2': 'name-role-value',
};

export function wcagUrl(sc: string): string {
  return 'https://www.w3.org/WAI/WCAG22/Understanding/' + (WCAG_SLUGS[sc] ?? '');
}
