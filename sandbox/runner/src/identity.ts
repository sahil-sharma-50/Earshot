import type { CDPSession } from 'playwright';
import type { ElementIdentity } from '@earshot/shared';

/**
 * Browser-side function (serialised with toString) that describes an element.
 * Kept free of closures so it runs in the page via Runtime.callFunctionOn or page.evaluate.
 */
export function describeElementInPage(this: Element | null, elArg?: Element): Omit<ElementIdentity, 'backendNodeId'> {
  const el = (elArg ?? this) as Element;
  const esc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
  const unique = (sel: string) => {
    try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
  };
  const tag = (e: Element) => e.tagName.toLowerCase();
  let cssPath = '';
  if (el.id && unique(`${tag(el)}#${esc(el.id)}`)) {
    cssPath = `${tag(el)}#${esc(el.id)}`;
  } else {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur !== el && cur.id && unique(`#${esc(cur.id)}`)) { parts.unshift(`#${esc(cur.id)}`); break; }
      let i = 1;
      let sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) i++; sib = sib.previousElementSibling; }
      parts.unshift(`${tag(cur)}:nth-of-type(${i})`);
      if (tag(cur) === 'body') break;
      cur = cur.parentElement;
    }
    cssPath = parts.join(' > ');
  }
  const html = el.outerHTML || '';
  const snippet = html.length > 300 ? html.slice(0, 297) + '...' : html;
  const isFinal = !!el.closest('[data-earshot-final]');
  const t = tag(el);
  const type = (el.getAttribute('type') || '').toLowerCase();
  const inForm = !!el.closest('form');
  const isFormSubmit = inForm && ((t === 'button' && (type === '' || type === 'submit')) || (t === 'input' && (type === 'submit' || type === 'image')));
  return { cssPath, snippet, isFinal, isFormSubmit };
}

export async function objectIdFor(cdp: CDPSession, backendNodeId: number): Promise<string> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
  if (!object.objectId) throw new Error('node not resolvable');
  return object.objectId;
}

export async function identify(cdp: CDPSession, backendNodeId: number): Promise<ElementIdentity> {
  const objectId = await objectIdFor(cdp, backendNodeId);
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: describeElementInPage.toString(),
    returnByValue: true,
  });
  return { ...(result.value as Omit<ElementIdentity, 'backendNodeId'>), backendNodeId };
}

/** backendNodeId for a page-side element found by selector. */
export async function backendIdForSelector(cdp: CDPSession, selector: string): Promise<number | null> {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
  if (!result.objectId) return null;
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
  return node.backendNodeId;
}
