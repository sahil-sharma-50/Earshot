import { expect, test } from 'vitest';
import type { Finding } from '@earshot/shared';
import { PATCH_JSON_SCHEMA, validatePatch } from '../src/fix/patch-schema.js';
import { applyPatchToSnippet, renderDiff } from '../src/fix/diff.js';

const finding = { id: 'f1', element: { cssPath: '.grind-swatch', snippet: '<div class="grind-swatch" data-grind="whole">Whole bean</div>' } } as Finding;

test('validatePatch accepts a well-formed patch and stamps the finding id', () => {
  expect(validatePatch({ selector: '.grind-swatch', attributes: { role: 'radio', tabindex: '0', 'aria-label': '$text' }, keyboardShim: true }, finding))
    .toEqual({ findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio', tabindex: '0', 'aria-label': '$text' }, keyboardShim: true });
});

test('validatePatch rejects script selectors and unknown attributes', () => {
  expect(validatePatch({ selector: 'script', attributes: {}, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: 'div{color:red}', attributes: {}, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: '<img>', attributes: {}, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: 'x'.repeat(201), attributes: {}, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: '.a', attributes: { onclick: 'alert(1)' }, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: '.a', attributes: { 'aria-label': '<b>x</b>' }, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: '.a', attributes: { 'aria-label': 'y'.repeat(201) }, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch({ selector: '.a', attributes: { role: 7 }, keyboardShim: false }, finding)).toHaveProperty('error');
  expect(validatePatch('nope', finding)).toHaveProperty('error');
});

test('schema lists only the patch attributes and forbids extras', () => {
  expect(PATCH_JSON_SCHEMA).toMatchObject({ additionalProperties: false, required: ['selector', 'attributes', 'keyboardShim'] });
  expect(Object.keys((PATCH_JSON_SCHEMA as any).properties.attributes.properties)).toEqual(['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'tabindex', 'aria-checked', 'aria-pressed']);
});

test('diff shows the attributes the patch adds to the element', () => {
  const after = applyPatchToSnippet(finding.element.snippet, { findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio', 'aria-label': '$text' }, keyboardShim: true });
  expect(after).toBe('<div class="grind-swatch" data-grind="whole" role="radio" aria-label="Whole bean" data-earshot-keyboard="Enter/Space→click">Whole bean</div>');
  const d = renderDiff(finding.element.snippet, after);
  expect(d).toContain('-<div class="grind-swatch" data-grind="whole">Whole bean</div>');
  expect(d).toContain('+<div class="grind-swatch" data-grind="whole" role="radio"');
});
