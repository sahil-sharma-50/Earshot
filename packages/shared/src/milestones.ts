import type { MilestoneId, Probe } from './types.js';

export const DEMO_MILESTONES: MilestoneId[] = ['on_product_page', 'grind_selected', 'in_cart', 'on_checkout', 'details_entered', 'on_review', 'awaiting_final_approval'];

/** Cumulative milestones reached at this probe. A later state implies every earlier milestone. */
export function evaluateMilestones(probe: Probe, gateReached: boolean): MilestoneId[] {
  const s = probe.store;
  if (!s) return [];
  let level = -1; // index into DEMO_MILESTONES of the furthest milestone reached
  const bump = (i: number) => { if (i > level) level = i; };
  if (s.page === 'product') bump(0);
  if (s.grind) bump(1);
  if (s.cart.length > 0) bump(2);
  if (s.page === 'checkout') bump(3);
  if (s.checkoutValid && s.cart.length > 0) bump(4);
  if (s.page === 'review' || s.page === 'confirmation') bump(5);
  if (gateReached || s.orderPlaced) bump(6);
  return DEMO_MILESTONES.slice(0, level + 1);
}
