import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ActResult, BlindObservation, Probe } from '@earshot/shared';
import { Runner } from '../src/main.js';
import { startStore } from './helpers.js';

let app: FastifyInstance;
let base: string;
let runner: Runner;

beforeAll(async () => {
  ({ app, base } = await startStore());
  runner = new Runner();
});
afterAll(async () => {
  await runner?.shutdown();
  await app?.close();
});

test('grind swatches appear only as non-actionable text', async () => {
  await runner.handle({ id: 1, m: 'open', url: `${base}/product/eth`, patches: [] });
  const obs = await runner.handle({ id: 2, m: 'observe', kind: 'blind' }) as BlindObservation;
  const whole = obs.nodes.find(n => n.name === 'Whole bean')!;
  expect(whole.actionable).toBe(false);
  expect(await runner.handle({ id: 3, m: 'act', kind: 'blind', action: { type: 'click', target: whole.ref } }))
    .toEqual({ ok: false, error: 'not-actionable' });
});

test('icon add-to-cart is an unnamed actionable button', async () => {
  const obs = await runner.handle({ id: 4, m: 'observe', kind: 'blind' }) as BlindObservation;
  expect(obs.nodes.some(n => n.role === 'button' && n.name === '' && n.actionable)).toBe(true);
});

test('click on actionable returns identity; probe reports store state', async () => {
  const obs = await runner.handle({ id: 5, m: 'observe', kind: 'blind' }) as BlindObservation;
  const sel = obs.nodes.find(n => n.role === 'combobox')!;
  const r = await runner.handle({ id: 6, m: 'act', kind: 'blind', action: { type: 'select', target: sel.ref, option: '500 g' } }) as ActResult;
  expect(r.ok).toBe(true); expect(r.element!.cssPath).toMatch(/select/);
  expect((await runner.handle({ id: 7, m: 'probe' }) as Probe).store!.page).toBe('product');
});

test('unknown ref', async () => {
  expect(await runner.handle({ id: 8, m: 'act', kind: 'blind', action: { type: 'click', target: 'a9999' } }))
    .toEqual({ ok: false, error: 'unknown-target' });
});

test('blind click on a real link navigates and the identity is captured first', async () => {
  await runner.handle({ id: 9, m: 'open', url: `${base}/`, patches: [] });
  const obs = await runner.handle({ id: 10, m: 'observe', kind: 'blind' }) as BlindObservation;
  const link = obs.nodes.find(n => n.role === 'link' && n.name === 'Ethiopia Guji')!;
  const r = await runner.handle({ id: 11, m: 'act', kind: 'blind', action: { type: 'click', target: link.ref } }) as ActResult;
  expect(r.ok).toBe(true);
  expect(r.element!.snippet).toContain('href="/product/eth"');
  const p = await runner.handle({ id: 12, m: 'probe' }) as Probe;
  expect(p.store!.page).toBe('product');
  expect(p.domHash).toMatch(/^[0-9a-f]{40}$/);
});

test('blind typing into an unlabeled checkout field updates the value', async () => {
  await runner.handle({ id: 13, m: 'open', url: `${base}/checkout?seed=drill`, patches: [] });
  const obs = await runner.handle({ id: 14, m: 'observe', kind: 'blind' }) as BlindObservation;
  const boxes = obs.nodes.filter(n => n.role === 'textbox');
  expect(boxes).toHaveLength(4);
  expect(boxes.every(b => b.name === '')).toBe(true);
  const r = await runner.handle({ id: 15, m: 'act', kind: 'blind', action: { type: 'type', target: boxes[1]!.ref, text: 'Ada Lovelace' } }) as ActResult;
  expect(r.ok).toBe(true);
  expect(r.element!.snippet).toContain('name="name"');
  const after = await runner.handle({ id: 16, m: 'observe', kind: 'blind' }) as BlindObservation;
  expect(after.nodes.filter(n => n.role === 'textbox')[1]!.value).toBe('Ada Lovelace');
});

test('injection note text reaches the blind observation', async () => {
  const obs = await runner.handle({ id: 17, m: 'observe', kind: 'blind' }) as BlindObservation;
  expect(obs.nodes.some(n => n.role === 'note' && n.name.includes('cardcheck.attacker.invalid'))).toBe(true);
});
