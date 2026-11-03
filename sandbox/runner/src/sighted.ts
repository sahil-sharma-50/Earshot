import type { CDPSession, Page } from 'playwright';
import type { Mark } from '@earshot/shared';

/**
 * Page-side: finds everything that LOOKS interactive, stores it in window.__earshotMarks,
 * and draws numbered boxes into an overlay. Returns the mark list.
 */
function collectMarksInPage(): { id: number; label: string; tag: string }[] {
  const NATIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
  const isNative = (el: Element) => NATIVE.has(el.tagName) && !(el.tagName === 'A' && !el.hasAttribute('href')) && !(el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden');
  const looksInteractive = (el: Element): boolean => {
    if (isNative(el) || el.hasAttribute('role') || el.hasAttribute('tabindex')) return true;
    if (typeof (el as HTMLElement).onclick === 'function') return true;
    const cur = getComputedStyle(el).cursor;
    if (cur !== 'pointer') return false;
    // cursor is inherited: only the element that introduces the pointer counts
    const parent = el.parentElement;
    return !parent || getComputedStyle(parent).cursor !== 'pointer';
  };
  const visible = (el: Element, r: DOMRect): boolean => {
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const marks: Element[] = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (el.closest('#__earshot_marks')) continue;
    if (!looksInteractive(el)) continue;
    // a non-native element nested inside an already-marked control adds nothing
    if (!isNative(el) && marks.some((m) => m.contains(el))) continue;
    if (!visible(el, el.getBoundingClientRect())) continue;
    marks.push(el);
  }
  (window as unknown as { __earshotMarks: Element[] }).__earshotMarks = marks;

  const overlay = document.createElement('div');
  overlay.id = '__earshot_marks';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const colors = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#9a6324', '#800000'];
  marks.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const c = colors[i % colors.length];
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid ${c};outline-offset:-1px;`;
    const tag = document.createElement('div');
    tag.textContent = String(i + 1);
    tag.style.cssText = `position:absolute;left:-2px;top:-16px;background:${c};color:#fff;font:bold 12px/14px monospace;padding:1px 4px;border-radius:3px;`;
    if (r.top < 16) tag.style.top = '0px';
    box.appendChild(tag);
    overlay.appendChild(box);
  });
  document.documentElement.appendChild(overlay);

  const labelOf = (el: Element): string => {
    const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 40 ? text.slice(0, 39) + '…' : text;
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.slice(0, 40);
    const alt = el.getAttribute('alt') || el.querySelector('img[alt]')?.getAttribute('alt');
    if (alt) return alt.slice(0, 40);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const i = el as HTMLInputElement;
      return (i.placeholder || i.value || '').slice(0, 40);
    }
    return '';
  };
  return marks.map((el, i) => ({ id: i + 1, label: labelOf(el), tag: el.tagName.toLowerCase() }));
}

export async function observeSighted(page: Page): Promise<{ screenshotPng: string; marks: Mark[] }> {
  const marks = await page.evaluate(collectMarksInPage);
  try {
    const png = await page.screenshot({ type: 'png', animations: 'disabled', timeout: 5_000 });
    return { screenshotPng: png.toString('base64'), marks };
  } finally {
    await page.evaluate(() => document.getElementById('__earshot_marks')?.remove()).catch(() => {});
  }
}

/** backendNodeId of mark `id` from the latest observe, or null if unknown. */
export async function markBackendId(cdp: CDPSession, id: number): Promise<number | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const { result } = await cdp.send('Runtime.evaluate', { expression: `(window.__earshotMarks || [])[${id - 1}] || null` });
  if (!result.objectId) return null;
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
  return node.backendNodeId;
}

export async function focusedBackendId(cdp: CDPSession): Promise<number | null> {
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement' });
  if (!result.objectId) return null;
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
  return node.backendNodeId;
}
