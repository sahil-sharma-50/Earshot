import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PATCH_TOKENS, previewPatch, type Patch, type PatchReport } from '@earshot/shared';
import { Runner } from '../src/main.js';

/**
 * The agreement suite: for each patch token and template behaviour, the diff preview built from the
 * page's report must equal what the patched element really looks like in Chromium.
 */

const PAGE = `<!doctype html><main>
<div class="swatch" data-grind="ground">Ground</div>
<div class="swatch" data-grind="whole">Whole bean</div>
<form><label class="row">Expiry <input name="exp"></label><label class="row">Name <input name="name" aria-label="old"></label></form>
<span class="btn">Place order</span>
</main>`;

let server: Server;
let base: string;
let runner: Runner;

beforeAll(async () => {
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  runner = new Runner();
});
afterAll(async () => {
  await runner?.shutdown();
  server?.close();
});

const outer = (sel: string) => runner.browser.page!.evaluate((s) => document.querySelector(s)!.outerHTML, sel);

/** Opens the page unpatched for the "before" snippet, then patched; returns before, the real after, and the report. */
async function applyFor(p: Patch): Promise<{ before: string; after: string; report: PatchReport | undefined }> {
  await runner.handle({ id: 1, m: 'open', url: base, patches: [] });
  const before = await outer(p.anchor!);
  await runner.handle({ id: 2, m: 'open', url: base, patches: [p] });
  const after = await outer(p.anchor!);
  const report = (await runner.handle({ id: 3, m: 'patchStatus' }) as Record<string, PatchReport>)[p.findingId];
  return { before, after, report };
}

const cases: [string, Patch][] = [
  ['$text names the anchor element, not the first match', { findingId: 'f1', selector: '.swatch', attributes: { 'aria-label': '$text' }, keyboardShim: false, anchor: '.swatch[data-grind="whole"]' }],
  ['$label uses the caption in the container', { findingId: 'f2', selector: 'form input', attributes: { 'aria-label': '$label' }, keyboardShim: false, anchor: 'input[name="exp"]' }],
  ['an existing attribute is replaced in place', { findingId: 'f3', selector: 'form input', attributes: { 'aria-label': '$label' }, keyboardShim: false, anchor: 'input[name="name"]' }],
  ['a radio role gets aria-checked="false" from the template', { findingId: 'f4', selector: '.swatch', attributes: { role: 'radio', tabindex: '0' }, keyboardShim: true, anchor: '.swatch[data-grind="whole"]' }],
  ['literal values pass through', { findingId: 'f5', selector: 'span.btn', attributes: { role: 'button', tabindex: '0', 'aria-describedby': 'x' }, keyboardShim: true, anchor: 'span.btn' }],
];

describe('preview agrees with the patched page', () => {
  test('every token is covered', () => {
    const used = new Set(cases.flatMap(([, p]) => Object.values(p.attributes)));
    for (const t of Object.keys(PATCH_TOKENS)) expect(used.has(t), t).toBe(true);
  });

  test.each(cases)('%s', async (_name, p) => {
    const { before, after, report } = await applyFor(p);
    expect(report?.matches).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    expect(previewPatch(before, p, report?.applied).split('\n')[0]).toBe(after);
  });
});
