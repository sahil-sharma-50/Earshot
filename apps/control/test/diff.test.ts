import { expect, test } from 'vitest';
import { previewPatch } from '@earshot/shared';
import { renderDiff } from '../src/fix/diff.js';

test('diff shows the element before and after its patch, with the keyboard handler as a note', () => {
  const before = '<div class="grind-swatch" data-grind="whole">Whole bean</div>';
  const after = previewPatch(before, { findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio', 'aria-label': '$text' }, keyboardShim: true }, { role: 'radio', 'aria-label': 'Whole bean', 'aria-checked': 'false' });
  const d = renderDiff(before, after);
  expect(d).toContain('-<div class="grind-swatch" data-grind="whole">Whole bean</div>');
  expect(d).toContain('+<div class="grind-swatch" data-grind="whole" role="radio" aria-label="Whole bean" aria-checked="false">Whole bean</div>');
  expect(d).toContain('+<!-- fixed keyboard handler: Enter and Space activate it -->');
});
