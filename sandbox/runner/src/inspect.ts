import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CDPSession, Page } from 'playwright';
import type { ElementReport } from '@earshot/shared';
import { backendIdForSelector, identify, objectIdFor } from './identity.js';
import { settle } from './browser.js';

let axeSource: string | null = null;
function axe(): string {
  if (!axeSource) axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  return axeSource;
}

const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const NON_FIELD_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'hidden', 'checkbox', 'radio']);

async function stateHash(page: Page): Promise<string> {
  const s = await page.evaluate(() => JSON.stringify({ u: location.href, t: document.body?.innerText ?? '', s: (window as unknown as { __earshotStore?: unknown }).__earshotStore ?? null }));
  return createHash('sha1').update(s).digest('hex');
}

/**
 * Deterministic facts about one element. Mutates page state (Tab walk, Enter press),
 * so it must be the last thing done in a sandbox (the inspector).
 */
export async function inspect(page: Page, cdp: CDPSession, cssPath: string): Promise<ElementReport> {
  const backendNodeId = await backendIdForSelector(cdp, cssPath);
  if (backendNodeId === null) throw new Error(`element not found: ${cssPath}`);
  const identity = await identify(cdp, backendNodeId);
  const objectId = await objectIdFor(cdp, backendNodeId);

  // 1. accessibility tree facts
  const { nodes } = (await cdp.send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false })) as unknown as {
    nodes: { ignored: boolean; role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number }[];
  };
  const ax = nodes.find((n) => n.backendDOMNodeId === backendNodeId) ?? nodes[0];
  const inAxTree = !!ax && !ax.ignored;
  const axRole = inAxTree ? String(ax!.role?.value ?? '') || null : null;
  const axName = inAxTree ? String(ax!.name?.value ?? '').trim() : '';

  // 2. DOM facts
  const { result: facts } = await cdp.send('Runtime.callFunctionOn', {
    objectId,
    returnByValue: true,
    functionDeclaration: function (this: HTMLElement) {
      const el = this as HTMLElement & { disabled?: boolean; placeholder?: string; type?: string };
      return { tabIndex: el.tabIndex, disabled: !!el.disabled, tag: el.tagName, type: (el.getAttribute('type') || '').toLowerCase(), placeholder: el.getAttribute('placeholder') || '' };
    }.toString(),
  });
  const f = facts.value as { tabIndex: number; disabled: boolean; tag: string; type: string; placeholder: string };
  const focusable = f.tabIndex >= 0 && !f.disabled;
  const isField = FIELD_TAGS.has(f.tag) && !(f.tag === 'INPUT' && NON_FIELD_INPUTS.has(f.type));
  const hasProgrammaticLabel = isField ? axName !== '' && axName !== f.placeholder.trim() : null;

  // 3. axe-core, scoped to the element's region; keep violations that include this element
  const hasAxe = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== 'undefined');
  if (!hasAxe) await page.evaluate(axe());
  const { result: axeRes } = await cdp.send('Runtime.callFunctionOn', {
    objectId,
    awaitPromise: true,
    returnByValue: true,
    functionDeclaration: async function (this: Element) {
      const target = this;
      const scope = target.closest('form,main,section') || document.body;
      const w = window as unknown as { axe: { run: (ctx: Element, opts: object) => Promise<{ violations: { id: string; impact: string; tags: string[]; nodes: { element?: Element }[] }[] }> } };
      const res = await w.axe.run(scope, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'], elementRef: true, resultTypes: ['violations'] });
      return res.violations
        .filter((v) => v.nodes.some((n) => n.element === target || (n.element && n.element.contains(target)) || (n.element && target.contains(n.element))))
        .map((v) => ({ id: v.id, impact: v.impact || '', tags: v.tags }));
    }.toString(),
  });
  const axeViolations = (axeRes.value ?? []) as ElementReport['axeViolations'];

  // 4. keyboard: reachable by Tab from the page start?
  let tabReachable = false;
  if (focusable) {
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); window.scrollTo(0, 0); });
    await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ window.__earshotTabTarget = this; }' });
    for (let i = 0; i < 60 && !tabReachable; i++) {
      await page.keyboard.press('Tab');
      tabReachable = await page.evaluate(() => document.activeElement === (window as unknown as { __earshotTabTarget?: Element }).__earshotTabTarget);
    }
  }

  // 5. does Enter activate it? (mutates state: last)
  let keyActivates: boolean | null = null;
  if (focusable) {
    const before = await stateHash(page);
    await cdp.send('DOM.focus', { backendNodeId }).catch(() => {});
    await page.keyboard.press('Enter');
    await settle(page);
    keyActivates = (await stateHash(page).catch(() => '')) !== before;
  }

  return { identity, inAxTree, axRole, axName, focusable, tabReachable, keyActivates, hasProgrammaticLabel, axeViolations };
}
