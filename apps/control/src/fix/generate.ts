import { PATCH_JSON_SCHEMA, PATCH_PROMPT, validatePatch, type Finding, type Patch } from '@earshot/shared';
import type { Inference } from '../inference/client.js';
import { formatAxNode } from '../agents/prompts.js';

const SYSTEM = `You repair web accessibility defects with a minimal ATTRIBUTE patch. You never write JavaScript.
${PATCH_PROMPT}`;

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
    const raw = await inference.json({ system: SYSTEM, user: lines.join('\n'), schemaName: 'patch', schema: PATCH_JSON_SCHEMA });
    return validatePatch(raw, finding);
  } catch (e) {
    return { error: `patch generation failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}
