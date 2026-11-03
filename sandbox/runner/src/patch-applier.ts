import type { Patch } from '@earshot/shared';

/**
 * The ONLY JavaScript ever injected for fixes. Patches are data (selector + whitelisted
 * attributes + a boolean); the behaviour is this fixed template. Model output never
 * becomes code.
 */
function applierTemplate(patches: { findingId: string; selector: string; attributes: Record<string, string>; keyboardShim: boolean }[]): void {
  const w = window as unknown as { __earshotPatchMatches: Record<string, number> };
  w.__earshotPatchMatches = {};
  for (const p of patches) w.__earshotPatchMatches[p.findingId] = 0;
  const shimmed = new WeakSet<Element>();
  const seen: Record<string, WeakSet<Element>> = {};
  const apply = () => {
    for (const p of patches) {
      let els: Element[] = [];
      try { els = Array.from(document.querySelectorAll(p.selector)); } catch { continue; }
      const s = (seen[p.findingId] ||= new WeakSet());
      let count = 0;
      for (const el of els) {
        count++;
        for (const [k, v] of Object.entries(p.attributes)) {
          // $text: the element's own text. $label: the visible caption in its container (text of
          // the parent minus the element's own text), for form fields with a sibling caption.
          const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const caption = () => {
            const parent = el.parentElement;
            if (!parent) return '';
            const clone = parent.cloneNode(true) as Element;
            clone.querySelectorAll('input,select,textarea,button,script,style').forEach((n) => n.remove());
            return (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          };
          const val = v === '$text' ? own : v === '$label' ? caption() : v;
          // state attributes are the template's to manage after the first apply (see the click sync below)
          if ((k === 'aria-checked' || k === 'aria-pressed') && s.has(el)) continue;
          if (el.getAttribute(k) !== val) el.setAttribute(k, val);
        }
        const role = el.getAttribute('role');
        if (!s.has(el) && (role === 'radio' || role === 'checkbox' || role === 'switch') && !el.hasAttribute('aria-checked')) el.setAttribute('aria-checked', 'false');
        if (p.keyboardShim && !shimmed.has(el)) {
          shimmed.add(el);
          // keep the announced state true to what a click did: a radio group has one checked item,
          // checkboxes/switches and toggle buttons flip
          el.addEventListener('click', () => {
            const r = el.getAttribute('role');
            if (r === 'radio') {
              let group: Element[] = [];
              try { group = Array.from(document.querySelectorAll(p.selector)); } catch { group = [el]; }
              for (const g of group) g.setAttribute('aria-checked', g === el ? 'true' : 'false');
            } else if (r === 'checkbox' || r === 'switch') {
              el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
            } else if (el.hasAttribute('aria-pressed')) {
              el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
            }
          });
          el.addEventListener('keydown', (ev) => {
            const e = ev as KeyboardEvent;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (el as HTMLElement).click();
            }
          });
        }
        s.add(el);
      }
      w.__earshotPatchMatches[p.findingId] = Math.max(w.__earshotPatchMatches[p.findingId] || 0, count);
    }
  };
  const start = () => {
    apply();
    new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

const BS = String.fromCharCode(92); // backslash, built at runtime so no escape sequence lives in source

export function applierSource(patches: Patch[]): string {
  const data = JSON.stringify(patches.map((p) => ({ findingId: p.findingId, selector: p.selector, attributes: p.attributes, keyboardShim: !!p.keyboardShim })))
    .replace(/</g, BS + 'u003c')
    .replaceAll(String.fromCharCode(0x2028), BS + 'u2028')
    .replaceAll(String.fromCharCode(0x2029), BS + 'u2029');
  return `(${applierTemplate.toString()})(${data});`;
}
