import { expect, test } from 'vitest';
import type { ElementReport } from '@earshot/shared';
import { classify } from '../src/attribution/classify.js';

const base = (over: Partial<ElementReport>): ElementReport => ({
  identity: { cssPath: 'x', backendNodeId: 1, snippet: '<x>', isFinal: false, isFormSubmit: false },
  inAxTree: true, axRole: 'button', axName: 'Ok', focusable: true, tabReachable: true, keyActivates: true, hasProgrammaticLabel: null, axeViolations: [], ...over,
});

test('grind swatch: wrong role, not keyboard operable', () => {
  const r = classify(base({ axRole: 'generic', axName: '', focusable: false, tabReachable: false, keyActivates: null }));
  expect(r.categories).toEqual(['wrong-role', 'not-keyboard-operable']);
  expect(r.wcag).toEqual(['2.1.1', '4.1.2']);
  expect(r.axeRules).toEqual([]);
});

test('element absent from the AX tree is not-exposed', () => {
  const r = classify(base({ inAxTree: false, axRole: null, axName: '', focusable: false, tabReachable: false, keyActivates: null }));
  expect(r.categories).toContain('not-exposed');
});

test('icon button: no-name with button-name rule mapped to 4.1.2', () => {
  const r = classify(base({ axName: '', axeViolations: [{ id: 'button-name', impact: 'critical', tags: ['wcag2a', 'wcag412', 'section508'] }] }));
  expect(r.categories).toEqual(['no-name']);
  expect(r.axeRules).toEqual(['button-name']);
  expect(r.wcag).toEqual(['4.1.2']);
});

test('unlabeled field: unlabeled-field only (Enter on a text field is not a keyboard failure)', () => {
  const r = classify(base({ axRole: 'textbox', axName: '', keyActivates: false, hasProgrammaticLabel: false, axeViolations: [{ id: 'label', impact: 'critical', tags: ['wcag2a', 'wcag412', 'wcag131'] }] }));
  expect(r.categories).toEqual(['no-name', 'unlabeled-field']);
  expect(r.axeRules).toEqual(['label']);
  expect(r.wcag).toEqual(['1.3.1', '4.1.2']);
});

test('a correct native button yields nothing', () => {
  expect(classify(base({}))).toEqual({ categories: [], axeRules: [], wcag: [] });
});

test('span with click handler: wrong role and not keyboard operable', () => {
  const r = classify(base({ axRole: 'StaticText', axName: 'Continue to review', focusable: false, tabReachable: false, keyActivates: null }));
  expect(r.categories).toEqual(['wrong-role', 'not-keyboard-operable']);
});
