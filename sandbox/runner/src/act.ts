import type { CDPSession, Page } from 'playwright';
import type { Action, ActResult, ElementIdentity } from '@earshot/shared';
import { settle } from './browser.js';
import { identify, objectIdFor } from './identity.js';

export const BLOCK_BODY = 'Blocked by Earshot egress policy';

const KEY_MAP: Record<string, string> = { Space: ' ' };

export type TargetLookup = (target: string) => Promise<{ backendNodeId: number; actionable: boolean } | { error: 'unknown-target' }>;

async function center(cdp: CDPSession, backendNodeId: number): Promise<{ x: number; y: number }> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {});
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId });
  const q = model.border;
  return { x: (q[0]! + q[2]! + q[4]! + q[6]!) / 4, y: (q[1]! + q[3]! + q[5]! + q[7]!) / 4 };
}

async function clickNode(page: Page, cdp: CDPSession, backendNodeId: number): Promise<void> {
  const { x, y } = await center(cdp, backendNodeId);
  await page.mouse.click(x, y);
}

async function typeInto(page: Page, cdp: CDPSession, backendNodeId: number, text: string): Promise<void> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {});
  await cdp.send('DOM.focus', { backendNodeId });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 5 });
}

/** Chooses a <select> option by exact label, value, or label prefix/substring (in that order). */
function selectOptionInPage(this: HTMLSelectElement, wanted: string): boolean {
  const opts = Array.from(this.options ?? []);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const w = norm(wanted);
  const pick = opts.find((o) => norm(o.text) === w) ?? opts.find((o) => norm(o.value) === w)
    ?? opts.find((o) => norm(o.text).startsWith(w)) ?? opts.find((o) => norm(o.text).includes(w));
  if (!pick) return false;
  this.focus();
  this.value = pick.value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

async function selectNode(cdp: CDPSession, backendNodeId: number, option: string): Promise<boolean> {
  const objectId = await objectIdFor(cdp, backendNodeId);
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: selectOptionInPage.toString(),
    arguments: [{ value: option }],
    returnByValue: true,
  });
  return result.value === true;
}

export async function navigate(page: Page, url: string): Promise<ActResult> {
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
    if (resp && resp.status() === 403) {
      const body = await resp.text().catch(() => '');
      if (body.startsWith(BLOCK_BODY)) return { ok: false, error: 'navigation-blocked' };
    }
    return { ok: true };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/timeout/i.test(msg)) return { ok: false, error: 'timeout' };
    return { ok: false, error: 'navigation-blocked' };
  }
}

/** Executes an element action (click/type/select) on an already-resolved node. */
export async function actOnNode(page: Page, cdp: CDPSession, backendNodeId: number, action: Action): Promise<ActResult> {
  let element: ElementIdentity;
  try {
    element = await identify(cdp, backendNodeId); // before acting: the page may navigate away
  } catch {
    return { ok: false, error: 'unknown-target' };
  }
  try {
    if (action.type === 'click') await clickNode(page, cdp, backendNodeId);
    else if (action.type === 'type') await typeInto(page, cdp, backendNodeId, action.text);
    else if (action.type === 'select') {
      if (!(await selectNode(cdp, backendNodeId, action.option))) return { ok: false, error: 'no-such-option', element };
    }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 200), element };
  }
  await settle(page);
  return { ok: true, element };
}

export async function act(page: Page, cdp: CDPSession, action: Action, lookup: TargetLookup): Promise<ActResult> {
  switch (action.type) {
    case 'click':
    case 'type':
    case 'select': {
      const t = await lookup(action.target);
      if ('error' in t) return { ok: false, error: t.error };
      if (!t.actionable) return { ok: false, error: 'not-actionable' };
      return actOnNode(page, cdp, t.backendNodeId, action);
    }
    case 'press':
      await page.keyboard.press(KEY_MAP[action.key] ?? action.key);
      await settle(page);
      return { ok: true };
    case 'scroll':
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, action.direction === 'down' ? 600 : -600);
      await page.waitForTimeout(250);
      return { ok: true };
    case 'navigate':
      return navigate(page, action.url);
    case 'done':
    case 'stuck':
      return { ok: true };
  }
}
