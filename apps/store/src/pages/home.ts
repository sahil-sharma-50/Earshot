import { layout, esc, eur } from '../layout.js';
import { PRODUCTS, storeState, type Session } from '../state.js';

export function homePage(s: Session): string {
  const cards = PRODUCTS.map((p) => `
    <article class="card">
      <a href="/product/${p.sku}" class="card-img"><img src="${p.img}" width="320" height="240"></a>
      <h2><a href="/product/${p.sku}">${esc(p.name)}</a></h2>
      <p class="notes">${esc(p.notes)}</p>
      <p class="price">from ${eur(p.price['250g']!)}</p>
    </article>`).join('');
  return layout({
    title: 'Shop',
    state: storeState(s, 'home'),
    cartCount: s.cart.length,
    body: `
<section class="hero">
  <h1>Freshly roasted, every Tuesday.</h1>
  <p>Single-origin coffee, roasted in small batches and shipped within 48 hours.</p>
</section>
<section class="grid">${cards}</section>`,
  });
}
