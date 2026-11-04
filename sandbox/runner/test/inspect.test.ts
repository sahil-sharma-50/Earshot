import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AxNodeView, BlindObservation, ElementReport, Patch } from '@earshot/shared';
import { Runner } from '../src/main.js';
import { applierSource } from '../src/patch-applier.js';
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

test('inspect classifies the grind swatch facts', async () => {
  await runner.handle({ id: 1, m: 'open', url: `${base}/product/eth`, patches: [] });
  const r = await runner.handle({ id: 2, m: 'inspect', cssPath: '.grind-swatch[data-grind="whole"]' }) as ElementReport;
  expect(r).toMatchObject({ focusable: false, tabReachable: false, keyActivates: null });
  expect(r.axRole === null || ['generic', 'StaticText', 'none'].includes(r.axRole)).toBe(true);
  expect(r.identity.snippet).toContain('grind-swatch');
});

test('inspect finds axe button-name on the icon button', async () => {
  const r = await runner.handle({ id: 3, m: 'inspect', cssPath: '.icon-btn' }) as ElementReport;
  expect(r.axeViolations.map(v => v.id)).toContain('button-name');
  expect(r).toMatchObject({ axRole: 'button', axName: '', focusable: true, tabReachable: true });
});

test('inspect flags an unlabeled checkout field', async () => {
  await runner.handle({ id: 4, m: 'open', url: `${base}/checkout?seed=drill`, patches: [] });
  const r = await runner.handle({ id: 5, m: 'inspect', cssPath: 'input[name="card"]' }) as ElementReport;
  expect(r.hasProgrammaticLabel).toBe(false);
  expect(r.axeViolations.map(v => v.id)).toContain('label');
});

test('patch makes swatches actionable for the blind agent and keyboard-operable', async () => {
  const patch: Patch = { findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio', 'aria-checked': 'false', tabindex: '0', 'aria-label': '$text' }, keyboardShim: true };
  await runner.handle({ id: 4, m: 'open', url: `${base}/product/eth`, patches: [patch] });
  const obs = await runner.handle({ id: 5, m: 'observe', kind: 'blind' }) as BlindObservation;
  expect(obs.nodes.find(n => n.name === 'Whole bean')).toMatchObject({ role: 'radio', actionable: true });
  expect(await runner.handle({ id: 6, m: 'patchStatus' })).toEqual({ f1: 4 });
  const r = await runner.handle({ id: 7, m: 'inspect', cssPath: '.grind-swatch[data-grind="whole"]' }) as ElementReport;
  expect(r).toMatchObject({ focusable: true, tabReachable: true, keyActivates: true });
});

test('patched span button navigates on Enter', async () => {
  const patch: Patch = { findingId: 'f4', selector: 'span.btn-primary', attributes: { role: 'button', tabindex: '0' }, keyboardShim: true };
  await runner.handle({ id: 8, m: 'open', url: `${base}/review?seed=review`, patches: [patch] });
  expect(await runner.handle({ id: 9, m: 'patchStatus' })).toEqual({ f4: 0 });
});

test('applier source contains only the fixed template plus JSON data', () => {
  const src = applierSource([{ findingId: 'x', selector: '.a', attributes: { 'aria-label': '</script><script>alert(1)</script>' }, keyboardShim: false }]);
  expect(src).not.toContain('</script>');
  expect(src).toContain('__earshotPatchMatches');
});

test('axSpeech returns the AX nodes of a region', async () => {
  await runner.handle({ id: 10, m: 'open', url: `${base}/product/eth`, patches: [] });
  const nodes = await runner.handle({ id: 11, m: 'axSpeech', cssPath: '.buy-row' }) as AxNodeView[];
  expect(nodes.some(n => n.role === 'button' && n.name === '')).toBe(true);
  expect(nodes.some(n => n.name === 'Ethiopia Guji')).toBe(false);
  const all = await runner.handle({ id: 12, m: 'axSpeech' }) as AxNodeView[];
  expect(all.length).toBeGreaterThan(nodes.length);
});

test('$label names form fields after the visible caption in their container', async () => {
  const patch: Patch = { findingId: 'f3', selector: 'form.checkout input', attributes: { 'aria-label': '$label' }, keyboardShim: false };
  await runner.handle({ id: 20, m: 'open', url: `${base}/checkout?seed=drill`, patches: [patch] });
  const obs = await runner.handle({ id: 21, m: 'observe', kind: 'blind' }) as BlindObservation;
  expect(obs.nodes.filter(n => n.role === 'textbox').map(n => n.name)).toEqual(['Expiry', 'Name', 'Card number', 'Address']);
  expect(await runner.handle({ id: 22, m: 'patchStatus' })).toEqual({ f3: 4 });
});

test('the fixed template keeps radio state in sync, so a screen reader hears the choice', async () => {
  const patch: Patch = { findingId: 'f1', selector: '.grind-swatch', attributes: { role: 'radio', tabindex: '0', 'aria-label': '$text', 'aria-checked': 'false' }, keyboardShim: true };
  await runner.handle({ id: 30, m: 'open', url: `${base}/product/eth`, patches: [patch] });
  let obs = await runner.handle({ id: 31, m: 'observe', kind: 'blind' }) as BlindObservation;
  const espresso = obs.nodes.find(n => n.name === 'Espresso')!;
  await runner.handle({ id: 32, m: 'act', kind: 'blind', action: { type: 'click', target: espresso.ref } });
  obs = await runner.handle({ id: 33, m: 'observe', kind: 'blind' }) as BlindObservation;
  const radios = obs.nodes.filter(n => n.role === 'radio');
  expect(radios.find(n => n.name === 'Espresso')!.states).toContain('checked');
  expect(radios.filter(n => n.states.includes('checked'))).toHaveLength(1);
  // a later DOM change (error message, re-render) must not reset the state back to the patch value
  await runner.browser.page!.evaluate(() => document.body.appendChild(document.createElement('div')));
  obs = await runner.handle({ id: 34, m: 'observe', kind: 'blind' }) as BlindObservation;
  expect(obs.nodes.find(n => n.role === 'radio' && n.name === 'Espresso')!.states).toContain('checked');
});

test('patch match counts survive navigation (a verified fix may end its rerun on another page)', async () => {
  const patch: Patch = { findingId: 'f9', selector: '.grind-swatch', attributes: { role: 'radio' }, keyboardShim: true };
  await runner.handle({ id: 40, m: 'open', url: `${base}/product/eth`, patches: [patch] });
  await runner.handle({ id: 41, m: 'act', kind: 'blind', action: { type: 'navigate', url: `${base}/cart` } });
  expect(await runner.handle({ id: 42, m: 'patchStatus' })).toEqual({ f9: 4 });
});

test('a patched page visited only in the middle of one action still counts its matches', async () => {
  const { createServer } = await import('node:http');
  // /hop has two matching swatches and redirects to the store's cart page almost immediately
  const hop = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><div class="hop-swatch">a</div><div class="hop-swatch">b</div><script>setTimeout(() => { location.href = ${JSON.stringify(`${base}/cart`)}; }, 30);</script>`);
  });
  await new Promise<void>((r) => hop.listen(0, '127.0.0.1', r));
  const port = (hop.address() as { port: number }).port;
  try {
    const patch: Patch = { findingId: 'f10', selector: '.hop-swatch', attributes: { role: 'radio' }, keyboardShim: false };
    await runner.handle({ id: 50, m: 'open', url: `${base}/product/eth`, patches: [patch] });
    await runner.handle({ id: 51, m: 'act', kind: 'blind', action: { type: 'navigate', url: `http://127.0.0.1:${port}/hop` } });
    await runner.browser.page!.waitForURL(`${base}/cart`);
    expect(await runner.handle({ id: 52, m: 'patchStatus' })).toEqual({ f10: 2 });
  } finally {
    hop.close();
  }
});

test('page-reported counts for unknown findings are ignored', async () => {
  const patch: Patch = { findingId: 'f11', selector: '.grind-swatch', attributes: { role: 'radio' }, keyboardShim: false };
  await runner.handle({ id: 60, m: 'open', url: `${base}/product/eth`, patches: [patch] });
  await runner.browser.page!.evaluate(() => (window as any).__earshotReportPatchMatches({ forged: 99, f11: -5 }));
  expect(await runner.handle({ id: 61, m: 'patchStatus' })).toEqual({ f11: 4 });
});
