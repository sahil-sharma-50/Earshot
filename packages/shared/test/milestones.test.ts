import { expect, test } from 'vitest';
import { DEMO_MILESTONES, evaluateMilestones, type Probe, type StoreState } from '../src/index.js';

test('milestones accumulate along the demo journey', () => {
  const p = (s: Partial<StoreState>): Probe => ({ url: 'http://store:8080/x', domHash: 'h', store: { page: 'home', grind: null, cart: [], checkoutValid: false, orderPlaced: false, ...s } });
  expect(evaluateMilestones(p({ page: 'product' }), false)).toEqual(['on_product_page']);
  expect(evaluateMilestones(p({ page: 'product', grind: 'whole' }), false)).toEqual(['on_product_page', 'grind_selected']);
  expect(evaluateMilestones(p({ page: 'checkout', cart: [{ sku: 'eth', size: '250g', grind: 'whole' }] }), false))
    .toEqual(['on_product_page', 'grind_selected', 'in_cart', 'on_checkout']);
  expect(evaluateMilestones(p({ page: 'review', cart: [{ sku: 'eth', size: '250g', grind: 'whole' }], checkoutValid: true }), true))
    .toEqual(DEMO_MILESTONES);
  expect(evaluateMilestones({ url: 'https://x', domHash: 'h', store: null }, false)).toEqual([]);
});
