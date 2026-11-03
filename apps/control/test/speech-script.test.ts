import { expect, test, vi } from 'vitest';
import { speechScript } from '../src/tts/speech-script.js';
import { createSynthesizer } from '../src/tts/synthesize.js';
import type { Inference } from '../src/inference/client.js';

test('unnamed controls are read by role only', () => {
  expect(speechScript([
    { ref: 'a1', role: 'button', name: '', states: [], actionable: true },
    { ref: 'a2', role: 'button', name: '', states: [], actionable: true },
    { ref: 'a3', role: 'link', name: '', states: [], actionable: true },
    { ref: 'a4', role: 'img', name: '', states: [], actionable: false },
  ])).toBe('button. button. link. image.');
  expect(speechScript([{ ref: 'a5', role: 'textbox', name: 'Card number', states: ['focused'], actionable: true }]))
    .toBe('Card number, edit text, focused.');
});

test('role words, headings and duplicate text', () => {
  expect(speechScript([
    { ref: 'a1', role: 'heading', name: 'Checkout', states: ['level 1'], actionable: false },
    { ref: 'a2', role: 'StaticText', name: 'Checkout', states: [], actionable: false },
    { ref: 'a3', role: 'combobox', name: 'Size', states: ['collapsed'], actionable: true, value: '250 g' },
    { ref: 'a4', role: 'radio', name: 'Whole bean', states: ['not checked'], actionable: true },
    { ref: 'a5', role: 'checkbox', name: 'Gift', states: [], actionable: true },
    { ref: 'a6', role: 'StaticText', name: 'Whole bean', states: [], actionable: false },
    { ref: 'a7', role: 'image', name: '', states: [], actionable: false },
  ])).toBe('Checkout, heading level 1. Size, combo box, collapsed. Whole bean, radio button, not checked. Gift, check box. Whole bean. image.');
});

test('caps at 1200 chars with an ellipsis', () => {
  const nodes = Array.from({ length: 200 }, (_, i) => ({ ref: `a${i}`, role: 'link', name: `Product number ${i}`, states: [], actionable: true }));
  const s = speechScript(nodes);
  expect(s.length).toBeLessThanOrEqual(1200);
  expect(s.endsWith('…')).toBe(true);
});

test('synthesize caches by script hash', async () => {
  const speech = vi.fn(async () => Buffer.from([1, 2, 3]));
  const synth = createSynthesizer({ speech } as unknown as Inference);
  const a = await synth('button. button.');
  const b = await synth('button. button.');
  expect(a.id).toBe(b.id);
  expect(a.id).toMatch(/^[0-9a-f]{40}$/);
  expect(speech).toHaveBeenCalledOnce();
  expect(synth.get(a.id)).toEqual(Buffer.from([1, 2, 3]));
});
