import type { Finding } from './types.js';

/**
 * The Patch module: everything about the attribute-only fixes. That covers what a patch may say,
 * how the model is told about it, how it is validated, the only JavaScript that ever applies it in
 * the page, how the page reports what it did, and the diff preview built from that report.
 * Model output is data; the behaviour is the fixed template below.
 */

export type PatchAttribute = 'role' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'tabindex' | 'aria-checked' | 'aria-pressed';
export const PATCH_ATTRIBUTES: readonly PatchAttribute[] = ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'tabindex', 'aria-checked', 'aria-pressed'];

/** Value tokens the template resolves on each element. */
export const PATCH_TOKENS = {
  $text: 'name an element after its own visible text',
  $label: 'name a form field after the visible caption next to it',
} as const;

export interface Patch {
  findingId: string;
  selector: string;
  attributes: Partial<Record<PatchAttribute, string>>;
  keyboardShim: boolean;
  /** The finding's element (its cssPath): the page reports what the patch wrote on this one. */
  anchor?: string;
}

/** What a patch did in one sandbox: elements matched, and the values written on the anchor (or first match). */
export interface PatchReport { matches: number; applied?: Partial<Record<PatchAttribute, string>> }

/* ------------------------------------------------------------------ telling the model */

/** The patch format as the model is told about it. */
export const PATCH_PROMPT = `Return JSON only: {"selector": string, "attributes": {..}, "keyboardShim": boolean}.
- selector: a CSS selector for the defective element. If identical sibling elements share the defect (e.g. a group of swatches or all inputs of a form), match all of them.
- attributes: only ${PATCH_ATTRIBUTES.join(', ')}.
${Object.entries(PATCH_TOKENS).map(([t, what]) => `  Use "${t}" as an aria-label value to ${what}.`).join('\n')}
- keyboardShim: true when a non-native element must be activatable with Enter/Space (a fixed, prewritten handler is attached). With the shim, radio/checkbox/switch roles get aria-checked kept in sync on click, so set aria-checked to "false" (never "true" on every option).
Typical fixes: clickable div/span → role (button/radio/link) + tabindex "0" + keyboardShim true; unnamed icon button → aria-label; unlabeled input → aria-label "$label".`;

export const PATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    selector: { type: 'string', description: 'CSS selector matching the defective element (and identical siblings with the same defect)' },
    attributes: {
      type: 'object',
      properties: Object.fromEntries(PATCH_ATTRIBUTES.map((a) => [a, { type: 'string' }])) as Record<PatchAttribute, { type: 'string' }>,
      additionalProperties: false,
    },
    keyboardShim: { type: 'boolean', description: 'true to make Enter/Space activate the element (fixed template)' },
  },
  required: ['selector', 'attributes', 'keyboardShim'],
  additionalProperties: false,
} as const;

const MAX = 200;

/** Turns model output into a Patch for this finding, or says why it can't. */
export function validatePatch(x: unknown, finding: Pick<Finding, 'id'> & { element: Pick<Finding['element'], 'cssPath'> }): Patch | { error: string } {
  if (!x || typeof x !== 'object') return { error: 'patch must be an object' };
  const o = x as Record<string, unknown>;
  const selector = typeof o.selector === 'string' ? o.selector.trim() : '';
  if (!selector) return { error: 'selector missing' };
  if (selector.length > MAX) return { error: 'selector too long' };
  if (/script|[<{}]/i.test(selector)) return { error: 'selector contains forbidden content' };
  const attrsIn = o.attributes && typeof o.attributes === 'object' && !Array.isArray(o.attributes) ? (o.attributes as Record<string, unknown>) : null;
  if (!attrsIn) return { error: 'attributes must be an object' };
  const attributes: Partial<Record<PatchAttribute, string>> = {};
  for (const [k, v] of Object.entries(attrsIn)) {
    if (!PATCH_ATTRIBUTES.includes(k as PatchAttribute)) return { error: `attribute not allowed: ${k}` };
    if (typeof v !== 'string') return { error: `attribute ${k} must be a string` };
    if (v.length > MAX || v.includes('<')) return { error: `attribute ${k} has a forbidden value` };
    attributes[k as PatchAttribute] = v;
  }
  if (o.keyboardShim !== undefined && typeof o.keyboardShim !== 'boolean') return { error: 'keyboardShim must be boolean' };
  if (Object.keys(attributes).length === 0 && !o.keyboardShim) return { error: 'patch changes nothing' };
  return { findingId: finding.id, selector, attributes, keyboardShim: o.keyboardShim === true, anchor: finding.element.cssPath };
}

/* ------------------------------------------------------------------ applying in the page */

/** Page-callable function the runner exposes; the template pushes its report through it. */
export const PATCH_REPORT_BINDING = '__earshotReportPatches';

type PageEntry = { matches: number; applied?: Record<string, string>; anchored?: boolean };

/** Serialised into the page. Self-contained: it may reference nothing outside its own body. */
function applierTemplate(patches: { findingId: string; selector: string; attributes: Record<string, string>; keyboardShim: boolean; anchor: string | null }[]): void {
  const w = window as unknown as { __earshotPatchReport: Record<string, PageEntry>; __earshotReportPatches?: (r: Record<string, PageEntry>) => void };
  const report: Record<string, PageEntry> = {};
  w.__earshotPatchReport = report;
  for (const p of patches) report[p.findingId] = { matches: 0 };
  let reported = '';
  const shimmed = new WeakSet<Element>();
  const seen: Record<string, WeakSet<Element>> = {};
  const isAnchor = (el: Element, anchor: string | null) => { try { return !!anchor && el.matches(anchor); } catch { return false; } };
  const apply = () => {
    for (const p of patches) {
      let els: Element[] = [];
      try { els = Array.from(document.querySelectorAll(p.selector)); } catch { continue; }
      const s = (seen[p.findingId] ||= new WeakSet());
      const entry = report[p.findingId]!;
      for (const el of els) {
        const first = !s.has(el);
        const wrote: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.attributes)) {
          // $text: the element's own text. $label: the visible caption in its container (text of
          // the parent minus its controls), for form fields with a sibling caption.
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
          if ((k === 'aria-checked' || k === 'aria-pressed') && !first) continue;
          if (el.getAttribute(k) !== val) el.setAttribute(k, val);
          wrote[k] = val;
        }
        const role = el.getAttribute('role');
        if (first && (role === 'radio' || role === 'checkbox' || role === 'switch') && !el.hasAttribute('aria-checked')) {
          el.setAttribute('aria-checked', 'false');
          wrote['aria-checked'] = 'false';
        }
        if (first) {
          const anchored = isAnchor(el, p.anchor);
          if (!entry.applied || (anchored && !entry.anchored)) { entry.applied = wrote; entry.anchored = anchored; }
        }
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
      entry.matches = Math.max(entry.matches, els.length);
    }
    // push the report when it changes: a page visited only mid-action still counts
    const now = JSON.stringify(report);
    if (now !== reported && typeof w.__earshotReportPatches === 'function') {
      reported = now;
      void Promise.resolve(w.__earshotReportPatches(JSON.parse(now))).catch(() => {});
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

/** The init script for a patched page: the fixed template called with the patches as JSON data. */
export function applierSource(patches: Patch[]): string {
  const data = JSON.stringify(patches.map((p) => ({ findingId: p.findingId, selector: p.selector, attributes: p.attributes, keyboardShim: !!p.keyboardShim, anchor: p.anchor ?? null })))
    .replace(/</g, BS + 'u003c')
    .replaceAll(String.fromCharCode(0x2028), BS + 'u2028')
    .replaceAll(String.fromCharCode(0x2029), BS + 'u2029');
  return `(${applierTemplate.toString()})(${data});`;
}

/** Page function: the current page's report, for a last read (a push may still be in flight). */
export function readPatchReport(): unknown {
  return (window as unknown as { __earshotPatchReport?: unknown }).__earshotPatchReport;
}

/* ------------------------------------------------------------------ the report, runner side */

const MAX_MATCHES = 100_000;
const MAX_APPLIED = 300;

/**
 * Collects page reports across every page of one session. The page is untrusted: only known
 * findings, sane counts and vocabulary attributes count. Applied values from the anchor element
 * win over those from another match.
 */
export class PatchTracker {
  private readonly entries = new Map<string, PatchReport & { anchored: boolean }>();

  constructor(patches: readonly Pick<Patch, 'findingId'>[]) {
    for (const p of patches) this.entries.set(p.findingId, { matches: 0, anchored: false });
  }

  merge(untrusted: unknown): void {
    if (!untrusted || typeof untrusted !== 'object') return;
    for (const [id, raw] of Object.entries(untrusted as Record<string, unknown>)) {
      const entry = this.entries.get(id);
      if (!entry || !raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.matches === 'number' && Number.isFinite(r.matches) && r.matches >= 0) {
        entry.matches = Math.max(entry.matches, Math.min(Math.floor(r.matches), MAX_MATCHES));
      }
      const applied = sanitizeApplied(r.applied);
      const anchored = r.anchored === true;
      if (applied && (!entry.applied || (anchored && !entry.anchored))) {
        entry.applied = applied;
        entry.anchored = anchored;
      }
    }
  }

  report(): Record<string, PatchReport> {
    return Object.fromEntries([...this.entries].map(([id, e]) => [id, e.applied ? { matches: e.matches, applied: { ...e.applied } } : { matches: e.matches }]));
  }
}

function sanitizeApplied(x: unknown): PatchReport['applied'] | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: Partial<Record<PatchAttribute, string>> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (PATCH_ATTRIBUTES.includes(k as PatchAttribute) && typeof v === 'string') out[k as PatchAttribute] = v.slice(0, MAX_APPLIED);
  }
  return out;
}

/* ------------------------------------------------------------------ the preview */

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
export const KEYBOARD_SHIM_NOTE = '<!-- fixed keyboard handler: Enter and Space activate it -->';

/**
 * The element's snippet once patched. `applied` is what the page reported writing; without it
 * (the patch matched nothing) the patch is shown exactly as written. The keyboard handler is not
 * an attribute, so it is shown as a comment line.
 */
export function previewPatch(snippet: string, patch: Patch, applied?: PatchReport['applied']): string {
  const values: Record<string, string | undefined> = applied ?? patch.attributes;
  let out = snippet;
  const end = snippet.indexOf('>');
  if (end >= 0) {
    let open = snippet.slice(0, end);
    const selfClose = open.endsWith('/');
    if (selfClose) open = open.slice(0, -1).trimEnd();
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const re = new RegExp(`\\s${name.replace(/-/g, '\\-')}="[^"]*"`);
      const attr = ` ${name}="${escAttr(value)}"`;
      open = re.test(open) ? open.replace(re, attr) : open + attr;
    }
    out = open + (selfClose ? ' />' : '>') + snippet.slice(end + 1);
  }
  return patch.keyboardShim ? `${out}\n${KEYBOARD_SHIM_NOTE}` : out;
}
