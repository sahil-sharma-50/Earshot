import { layout } from '../layout.js';
import { storeState, type Session } from '../state.js';

export function confirmationPage(s: Session): string {
  return layout({
    title: 'Order placed',
    state: storeState(s, 'confirmation'),
    cartCount: 0,
    body: `
<section class="panel">
  <h1>Order placed</h1>
  <p>Thank you! This is a demo store, so nothing was charged and nothing will ship.</p>
  <a class="btn-secondary" href="/">Back to the shop</a>
</section>`,
  });
}
