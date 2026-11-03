import { PATCH_ATTRIBUTES, type Finding, type Patch, type PatchAttribute } from '@earshot/shared';

export const PATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    selector: { type: 'string', description: 'CSS selector matching the defective element (and identical siblings with the same defect)' },
    attributes: {
      type: 'object',
      properties: Object.fromEntries(PATCH_ATTRIBUTES.map((a) => [a, { type: 'string' }])),
      additionalProperties: false,
    },
    keyboardShim: { type: 'boolean', description: 'true to make Enter/Space activate the element (fixed template)' },
  },
  required: ['selector', 'attributes', 'keyboardShim'],
  additionalProperties: false,
} as const;

const MAX = 200;

export function validatePatch(x: unknown, finding: Pick<Finding, 'id'>): Patch | { error: string } {
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
  return { findingId: finding.id, selector, attributes, keyboardShim: o.keyboardShim === true };
}
