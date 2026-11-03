import { ACTIONABLE_ROLES, CATEGORY_RULES, type ElementReport, type FailureCategory } from '@earshot/shared';

/**
 * Deterministic verdict on the element the sighted agent used and the blind agent could not.
 * Every finding Earshot reports must have at least one category from here.
 */
export function classify(report: ElementReport): { categories: FailureCategory[]; axeRules: string[]; wcag: string[] } {
  const cats = new Set<FailureCategory>();
  const role = report.axRole ?? '';
  const actionableRole = ACTIONABLE_ROLES.includes(role);
  const isField = report.hasProgrammaticLabel !== null;

  if (!report.inAxTree) cats.add('not-exposed');
  if (report.inAxTree && actionableRole && report.axName.trim() === '') cats.add('no-name');
  // the sighted agent acted on it, so it IS a control; a non-control role is wrong
  if (!actionableRole) cats.add('wrong-role');
  // Enter on a text field legitimately does nothing, so keyActivates only counts for non-fields
  if (!report.focusable || !report.tabReachable || (!isField && report.keyActivates === false)) cats.add('not-keyboard-operable');
  if (report.hasProgrammaticLabel === false) cats.add('unlabeled-field');

  const order: FailureCategory[] = ['not-exposed', 'no-name', 'wrong-role', 'not-keyboard-operable', 'unlabeled-field'];
  const categories = order.filter((c) => cats.has(c));

  const axeRules = [...new Set(report.axeViolations.map((v) => v.id))];
  const wcag = new Set<string>();
  for (const c of categories) for (const sc of CATEGORY_RULES[c].wcag) wcag.add(sc);
  for (const v of report.axeViolations) {
    for (const tag of v.tags) {
      const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
      if (m) wcag.add(`${m[1]}.${m[2]}.${m[3]}`);
    }
  }
  const byNumber = (a: string, b: string) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return pa[0]! - pb[0]! || pa[1]! - pb[1]! || pa[2]! - pb[2]!;
  };
  return { categories, axeRules, wcag: [...wcag].sort(byNumber) };
}
