import { layout, esc, eur } from '../layout.js';
import { GRINDS, SIZES, storeState, type Product, type Session } from '../state.js';

const CART_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5.2 4l.4 2H20a1 1 0 0 1 1 1.2l-1.5 7A1 1 0 0 1 18.5 15H8a1 1 0 0 1-1-.8L4.4 3H2V1h3a1 1 0 0 1 1 .8L6.4 4Z"/></svg>';

export function productPage(s: Session, p: Product): string {
  // Planted bug 1: grind swatches are plain divs with click listeners (store.js); no role, tabindex or name.
  const swatches = GRINDS.map((g) => `<div class="grind-swatch" data-grind="${g.id}">${esc(g.label)}</div>`).join('\n      ');
  const sizes = SIZES.map((z) => `<option value="${z.id}">${z.label} · ${eur(p.price[z.id]!)}</option>`).join('');
  return layout({
    title: p.name,
    state: storeState(s, 'product'),
    cartCount: s.cart.length,
    body: `
<section class="product">
  <div class="product-img"><img src="${p.img}" width="480" height="360"></div>
  <div class="product-info">
    <p class="origin">${esc(p.origin)}</p>
    <h1>${esc(p.name)}</h1>
    <p class="notes">${esc(p.notes)}</p>
    <form class="add-form" method="post" action="/cart/add">
      <input type="hidden" name="sku" value="${p.sku}">
      <input type="hidden" name="grind" value="">
      <label class="size-label" for="size">Size</label>
      <select id="size" name="size">${sizes}</select>
      <div class="picker-title">Grind</div>
      <div class="grind-picker">
      ${swatches}
      </div>
      <p class="grind-error" hidden></p>
      <div class="buy-row">
        <span class="price">${eur(p.price['250g']!)}</span>
        <button class="icon-btn" type="submit">${CART_SVG}</button>
      </div>
    </form>
  </div>
</section>`,
  });
}
