import type { StoreState } from '@earshot/shared';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function eur(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €';
}

export function layout(opts: { title: string; state: StoreState; body: string; cartCount: number }): string {
  // JSON is embedded in a script tag: escape "<" so no value can close the tag.
  const stateJson = JSON.stringify(opts.state).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · Kaffeebohne Roasters</title>
<link rel="stylesheet" href="/store.css">
<script>window.__earshotStore = ${stateJson};</script>
</head>
<body>
<header class="top">
  <a class="brand" href="/"><img src="/img/logo.svg" width="36" height="36"><span>Kaffeebohne Roasters</span></a>
  <nav><a href="/">Shop</a><a href="/cart" class="cart-link">Cart (${opts.cartCount})</a></nav>
</header>
<main>
${opts.body}
</main>
<footer class="foot">Kaffeebohne Roasters · Small-batch coffee from Leipzig · Demo store, nothing is ever charged</footer>
<script src="/store.js"></script>
</body>
</html>`;
}
