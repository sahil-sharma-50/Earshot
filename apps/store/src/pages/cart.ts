import { layout, esc, eur } from '../layout.js';
import { GRINDS, PRODUCTS, SIZES, storeState, type Session } from '../state.js';

export function lineItems(s: Session): { html: string; total: number } {
  let total = 0;
  const rows = s.cart.map((c) => {
    const p = PRODUCTS.find((x) => x.sku === c.sku)!;
    const price = p.price[c.size] ?? 0;
    total += price;
    const size = SIZES.find((z) => z.id === c.size)?.label ?? c.size;
    const grind = GRINDS.find((g) => g.id === c.grind)?.label ?? c.grind;
    return `<li><span>${esc(p.name)} · ${esc(size)} · ${esc(grind)}</span><span>${eur(price)}</span></li>`;
  }).join('');
  return { html: `<ul class="lines">${rows}</ul><p class="total"><span>Total</span><span>${eur(total)}</span></p>`, total };
}

export function cartPage(s: Session): string {
  const body = s.cart.length === 0
    ? `<section class="panel"><h1>Your cart</h1><p>Your cart is empty.</p><a class="btn-secondary" href="/">Continue shopping</a></section>`
    : `<section class="panel"><h1>Your cart</h1>${lineItems(s).html}<a class="btn-primary" href="/checkout">Checkout</a></section>`;
  return layout({ title: 'Cart', state: storeState(s, 'cart'), cartCount: s.cart.length, body });
}
