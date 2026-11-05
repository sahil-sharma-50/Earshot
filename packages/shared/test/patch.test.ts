import { describe, expect, test } from 'vitest';
import {
  applierSource, PATCH_ATTRIBUTES, PATCH_JSON_SCHEMA, PATCH_PROMPT, PATCH_TOKENS, PatchTracker, previewPatch, validatePatch,
  type Finding, type Patch,
} from '../src/index.js';

const finding = { id: 'f1', element: { cssPath: 'main > div.grind-swatch:nth-child(2)', snippet: '<div class="grind-swatch" data-grind="whole">Whole bean</div>' } } as Finding;
const patch = (over: Partial<Patch> = {}): Patch => ({ findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio' }, keyboardShim: false, ...over });

describe('validatePatch', () => {
  test('accepts a well-formed patch, stamps the finding id and anchors it on the finding element', () => {
    expect(validatePatch({ selector: '.grind-swatch', attributes: { role: 'radio', tabindex: '0', 'aria-label': '$text' }, keyboardShim: true }, finding))
      .toEqual({ findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio', tabindex: '0', 'aria-label': '$text' }, keyboardShim: true, anchor: 'main > div.grind-swatch:nth-child(2)' });
  });

  test.each([
    ['script selector', { selector: 'script', attributes: {}, keyboardShim: false }],
    ['css block', { selector: 'div{color:red}', attributes: {}, keyboardShim: false }],
    ['markup selector', { selector: '<img>', attributes: {}, keyboardShim: false }],
    ['long selector', { selector: 'x'.repeat(201), attributes: {}, keyboardShim: false }],
    ['unknown attribute', { selector: '.a', attributes: { onclick: 'alert(1)' }, keyboardShim: false }],
    ['markup value', { selector: '.a', attributes: { 'aria-label': '<b>x</b>' }, keyboardShim: false }],
    ['long value', { selector: '.a', attributes: { 'aria-label': 'y'.repeat(201) }, keyboardShim: false }],
    ['non-string value', { selector: '.a', attributes: { role: 7 }, keyboardShim: false }],
    ['no change', { selector: '.a', attributes: {}, keyboardShim: false }],
    ['not an object', 'nope'],
  ])('rejects %s', (_name, raw) => {
    expect(validatePatch(raw, finding)).toHaveProperty('error');
  });
});

describe('vocabulary', () => {
  test('the schema lists exactly the patch attributes and forbids extras', () => {
    expect(PATCH_JSON_SCHEMA).toMatchObject({ additionalProperties: false, required: ['selector', 'attributes', 'keyboardShim'] });
    expect(Object.keys(PATCH_JSON_SCHEMA.properties.attributes.properties)).toEqual([...PATCH_ATTRIBUTES]);
  });

  test('the prompt names every attribute and every token', () => {
    for (const a of PATCH_ATTRIBUTES) expect(PATCH_PROMPT).toContain(a);
    for (const t of Object.keys(PATCH_TOKENS)) expect(PATCH_PROMPT).toContain(`"${t}"`);
    expect(PATCH_PROMPT).toContain('keyboardShim');
  });

  test('applier source is the fixed template plus escaped JSON data', () => {
    const src = applierSource([patch({ attributes: { 'aria-label': '</script><script>alert(1)</script>' } })]);
    expect(src).not.toContain('</script>');
    expect(src).not.toContain('<script>');
  });
});

describe('PatchTracker', () => {
  test('keeps the highest match count per known finding and ignores forged or broken entries', () => {
    const t = new PatchTracker([patch({ findingId: 'a' }), patch({ findingId: 'b' })]);
    expect(t.report()).toEqual({ a: { matches: 0 }, b: { matches: 0 } });
    t.merge({ a: { matches: 3 }, forged: { matches: 99 }, b: { matches: -5 } });
    t.merge({ a: { matches: 1 } });
    t.merge('junk');
    t.merge({ a: 7 });
    expect(t.report()).toEqual({ a: { matches: 3 }, b: { matches: 0 } });
  });

  test('keeps applied values from the anchor element over those of another match', () => {
    const t = new PatchTracker([patch()]);
    t.merge({ f1: { matches: 4, applied: { role: 'radio', 'aria-label': 'Ground' }, anchored: false } });
    t.merge({ f1: { matches: 4, applied: { role: 'radio', 'aria-label': 'Whole bean' }, anchored: true } });
    t.merge({ f1: { matches: 4, applied: { role: 'radio', 'aria-label': 'Espresso' }, anchored: true } });
    expect(t.report().f1).toEqual({ matches: 4, applied: { role: 'radio', 'aria-label': 'Whole bean' } });
  });

  test('drops applied attributes outside the vocabulary and caps long values', () => {
    const t = new PatchTracker([patch()]);
    t.merge({ f1: { matches: 1, applied: { onclick: 'x', role: 'radio', 'aria-label': 'z'.repeat(900), tabindex: 0 }, anchored: true } });
    const applied = t.report().f1!.applied!;
    expect(Object.keys(applied)).toEqual(['role', 'aria-label']);
    expect(applied['aria-label']!.length).toBeLessThanOrEqual(300);
  });
});

describe('previewPatch', () => {
  const before = finding.element.snippet;

  test('writes the values the page applied onto the element’s opening tag', () => {
    expect(previewPatch(before, patch(), { role: 'radio', 'aria-label': 'Whole bean', 'aria-checked': 'false' }))
      .toBe('<div class="grind-swatch" data-grind="whole" role="radio" aria-label="Whole bean" aria-checked="false">Whole bean</div>');
  });

  test('replaces an attribute in place and handles void elements', () => {
    expect(previewPatch('<input name="exp" aria-label="x">', patch(), { 'aria-label': 'Expiry' })).toBe('<input name="exp" aria-label="Expiry">');
    expect(previewPatch('<input name="exp" />', patch(), { 'aria-label': 'Expiry' })).toBe('<input name="exp" aria-label="Expiry" />');
  });

  test('without a page report it shows the patch exactly as written, tokens included', () => {
    expect(previewPatch(before, patch({ attributes: { 'aria-label': '$label' } }))).toBe('<div class="grind-swatch" data-grind="whole" aria-label="$label">Whole bean</div>');
  });

  test('the keyboard handler appears as a comment line, never as an invented attribute', () => {
    const after = previewPatch(before, patch({ keyboardShim: true }), { role: 'radio' });
    expect(after.split('\n')).toEqual([
      '<div class="grind-swatch" data-grind="whole" role="radio">Whole bean</div>',
      '<!-- fixed keyboard handler: Enter and Space activate it -->',
    ]);
  });

  test('escapes quotes and ampersands like the DOM does', () => {
    expect(previewPatch('<b>', patch(), { 'aria-label': 'Tom & "Jerry"' })).toBe('<b aria-label="Tom &amp; &quot;Jerry&quot;">');
  });
});
