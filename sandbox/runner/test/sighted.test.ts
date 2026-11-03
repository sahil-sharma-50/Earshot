import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Action, ActResult, ElementIdentity, Probe, SightedObservation } from '@earshot/shared';
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

test('sighted sees and can click grind swatches', async () => {
  await runner.handle({ id: 1, m: 'open', url: `${base}/product/eth`, patches: [] });
  const obs = await runner.handle({ id: 2, m: 'observe', kind: 'sighted' }) as SightedObservation;
  expect(Buffer.from(obs.screenshotPng, 'base64').subarray(1, 4).toString()).toBe('PNG');
  const m = obs.marks.find(x => x.label === 'Whole bean')!;
  const r = await runner.handle({ id: 3, m: 'act', kind: 'sighted', action: { type: 'click', target: String(m.id) } }) as ActResult;
  expect(r.ok).toBe(true);
  expect((await runner.handle({ id: 4, m: 'probe' }) as Probe).store!.grind).toBe('whole');
});

test('marks skip inherited-pointer children and the visually hidden injection note', async () => {
  await runner.handle({ id: 5, m: 'open', url: `${base}/checkout?seed=drill`, patches: [] });
  const obs = await runner.handle({ id: 6, m: 'observe', kind: 'sighted' }) as SightedObservation;
  expect(obs.marks.filter(m => m.tag === 'input')).toHaveLength(4);
  expect(obs.marks.some(m => m.label === 'Continue to review')).toBe(true);
  expect(obs.marks.some(m => m.tag === 'svg' || m.tag === 'path')).toBe(false);
  expect(JSON.stringify(obs.marks)).not.toContain('cardcheck');
  // the overlay is removed after the screenshot
  expect(await runner.browser.page!.locator('#__earshot_marks').count()).toBe(0);
});

test('describe flags the final button', async () => {
  await runner.handle({ id: 7, m: 'open', url: `${base}/review?seed=review`, patches: [] });
  const obs = await runner.handle({ id: 9, m: 'observe', kind: 'sighted' }) as SightedObservation;
  const place = obs.marks.find(x => x.label === 'Place order')!;
  expect((await runner.handle({ id: 10, m: 'describe', kind: 'sighted', target: String(place.id) }) as ElementIdentity).isFinal).toBe(true);
});

test('describe focused reports the active element', async () => {
  const p = runner.browser.page!;
  await p.focus('[data-earshot-final]');
  expect((await runner.handle({ id: 12, m: 'describe', kind: 'blind', target: 'focused' }) as ElementIdentity).isFinal).toBe(true);
});

test('replay reproduces a recorded journey', async () => {
  const recorded: { cssPath: string; action: Action }[] = [];
  const clickMark = async (pred: (label: string, tag: string) => boolean) => {
    const obs = await runner.handle({ id: 20, m: 'observe', kind: 'sighted' }) as SightedObservation;
    const mark = obs.marks.find(m => pred(m.label, m.tag))!;
    expect(mark).toBeDefined();
    const action: Action = { type: 'click', target: String(mark.id) };
    const r = await runner.handle({ id: 21, m: 'act', kind: 'sighted', action }) as ActResult;
    expect(r.ok).toBe(true);
    recorded.push({ cssPath: r.element!.cssPath, action });
  };
  await runner.handle({ id: 19, m: 'open', url: `${base}/product/eth`, patches: [] });
  await clickMark((l) => l === 'Espresso');
  await clickMark((l, t) => t === 'button' && l === '');
  expect((await runner.handle({ id: 22, m: 'probe' }) as Probe).store!.page).toBe('cart');
  await clickMark((l) => l === 'Checkout');
  expect((await runner.handle({ id: 23, m: 'probe' }) as Probe).store!.page).toBe('checkout');

  const fresh = new Runner();
  try {
    await fresh.handle({ id: 1, m: 'open', url: `${base}/product/eth`, patches: [] });
    expect(await fresh.handle({ id: 2, m: 'replay', actions: recorded })).toEqual({ replayed: 3 });
    const p = await fresh.handle({ id: 3, m: 'probe' }) as Probe;
    expect(p.store!.page).toBe('checkout');
    expect(p.store!.cart).toEqual([{ sku: 'eth', size: '250g', grind: 'espresso' }]);
  } finally {
    await fresh.shutdown();
  }
});

test('replay stops at the first failing step', async () => {
  await runner.handle({ id: 30, m: 'open', url: `${base}/product/eth`, patches: [] });
  const r = await runner.handle({ id: 31, m: 'replay', actions: [
    { cssPath: '.grind-swatch[data-grind="whole"]', action: { type: 'click', target: '1' } },
    { cssPath: '#does-not-exist', action: { type: 'click', target: '2' } },
    { cssPath: '.icon-btn', action: { type: 'click', target: '3' } },
  ] });
  expect(r).toEqual({ replayed: 1 });
});
