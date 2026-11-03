import { layout, esc } from '../layout.js';
import { storeState, type Session } from '../state.js';
import { lineItems } from './cart.js';

export function reviewPage(s: Session): string {
  const d = s.checkout!;
  const last4 = d.card.replace(/\s+/g, '').slice(-4);
  return layout({
    title: 'Review order',
    state: storeState(s, 'review'),
    cartCount: s.cart.length,
    body: `
<section class="panel">
  <h1>Review your order</h1>
  ${lineItems(s).html}
  <dl class="review">
    <dt>Ship to</dt><dd>${esc(d.name)}, ${esc(d.address)}</dd>
    <dt>Card</dt><dd>•••• ${esc(last4)} (expires ${esc(d.expiry)})</dd>
  </dl>
  <form method="post" action="/order">
    <button class="btn-primary" type="submit" data-earshot-final>Place order</button>
  </form>
</section>`,
  });
}
