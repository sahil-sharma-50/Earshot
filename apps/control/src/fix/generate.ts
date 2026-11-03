import type { Finding, Patch } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import { formatAxNode } from '../agents/prompts.js';
import { PATCH_JSON_SCHEMA, validatePatch } from './patch-schema.js';

const SYSTEM = `You repair web accessibility defects with a minimal ATTRIBUTE patch. You never write JavaScript.
Return JSON only: {"selector": string, "attributes": {..}, "keyboardShim": boolean}.
- selector: a CSS selector for the defective element. If identical sibling elements share the defect (e.g. a group of swatches or all inputs of a form), match all of them.
- attributes: only role, aria-label, aria-labelledby, aria-describedby, tabindex, aria-checked, aria-pressed.
  Use "$text" as an aria-label value to name an element after its own visible text.
  Use "$label" as an aria-label value to name a form field after the visible caption next to it.
- keyboardShim: true when a non-native element must be activatable with Enter/Space (a fixed, prewritten handler is attached). With the shim, radio/checkbox/switch roles get aria-checked kept in sync on click, so set aria-checked to "false" (never "true" on every option).
Typical fixes: clickable div/span → role (button/radio/link) + tabindex "0" + keyboardShim true; unnamed icon button → aria-label; unlabeled input → aria-label "$label".`;

export async function generatePatch(
  inference: Inference,
  finding: Finding,
  previousAttempt?: { patch?: Patch; failure: string },
): Promise<Patch | { error: string }> {
  const lines = [
    `Defective element (from the page): ${finding.element.snippet}`,
    `CSS path: ${finding.element.cssPath}`,
    `Failure categories: ${finding.categories.join(', ') || 'none'}`,
    `axe rules: ${finding.axeRules.join(', ') || 'none'} · WCAG: ${finding.wcag.join(', ')}`,
    `The journey step it blocks: ${finding.milestone}`,
    `What a screen reader perceives in that region:`,
    ...finding.evidence.blindExcerpt.slice(0, 30).map(formatAxNode),
  ];
  if (previousAttempt) {
    lines.push('', `A previous patch failed: ${previousAttempt.failure}`);
    if (previousAttempt.patch) lines.push(`Previous patch: ${JSON.stringify({ selector: previousAttempt.patch.selector, attributes: previousAttempt.patch.attributes, keyboardShim: previousAttempt.patch.keyboardShim })}`);
    lines.push('Return a different patch that fixes it.');
  }
  try {
    const raw = await inference.json<unknown>({ system: SYSTEM, user: lines.join('\n'), schemaName: 'patch', schema: PATCH_JSON_SCHEMA });
    return validatePatch(raw, finding);
  } catch (e) {
    return { error: `patch generation failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}
