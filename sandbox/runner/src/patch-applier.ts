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
          const val = v === '$text' ? (el.textContent || '').replace(/\s+/g, ' ').trim() : v;
          if (el.getAttribute(k) !== val) el.setAttribute(k, val);
        }
        if (p.keyboardShim && !shimmed.has(el)) {
          shimmed.add(el);
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
