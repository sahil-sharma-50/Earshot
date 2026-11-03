import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSession, getSession, GRINDS, isValidCheckout, PRODUCTS, SIZES, type Session } from './state.js';
import { homePage } from './pages/home.js';
import { productPage } from './pages/product.js';
import { cartPage } from './pages/cart.js';
import { checkoutPage } from './pages/checkout.js';
import { reviewPage } from './pages/review.js';
import { confirmationPage } from './pages/confirmation.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

declare module 'fastify' {
  interface FastifyRequest { session: Session }
}

function readSid(req: FastifyRequest): string | undefined {
  const m = /(?:^|;\s*)sid=([a-f0-9]{32})/.exec(req.headers.cookie ?? '');
  return m?.[1];
}

function bindSession(req: FastifyRequest, reply: FastifyReply, fresh = false): Session {
  let s = fresh ? undefined : getSession(readSid(req));
  if (!s) {
    s = createSession();
    reply.header('set-cookie', `sid=${s.id}; Path=/; HttpOnly; SameSite=Lax`);
  }
  req.session = s;
  return s;
}

function html(reply: FastifyReply, body: string) {
  return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(body);
}

export function createStoreServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/', index: false, wildcard: false });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/', (req, reply) => html(reply, homePage(bindSession(req, reply))));

  app.get<{ Params: { sku: string } }>('/product/:sku', (req, reply) => {
    const s = bindSession(req, reply);
    const p = PRODUCTS.find((x) => x.sku === req.params.sku);
    if (!p) return reply.code(404).type('text/plain').send('Not found');
    return html(reply, productPage(s, p));
  });

  app.post<{ Body: Record<string, string> }>('/cart/add', (req, reply) => {
    const s = bindSession(req, reply);
    const { sku = '', size = '', grind = '' } = req.body ?? {};
    const p = PRODUCTS.find((x) => x.sku === sku);
    if (!p) return reply.code(400).send('Unknown product');
    if (!GRINDS.some((g) => g.id === grind) || !SIZES.some((z) => z.id === size)) return reply.redirect(`/product/${p.sku}`, 303);
    s.cart.push({ sku, size, grind });
    s.orderPlaced = false;
    return reply.redirect('/cart', 303);
  });

  app.get('/cart', (req, reply) => html(reply, cartPage(bindSession(req, reply))));

  app.get<{ Querystring: { seed?: string } }>('/checkout', (req, reply) => {
    const seeded = req.query.seed === 'drill';
    const s = bindSession(req, reply, seeded);
    if (seeded) s.cart.push({ sku: 'eth', size: '250g', grind: 'whole' });
    if (s.cart.length === 0) return reply.redirect('/cart', 303);
    return html(reply, checkoutPage(s));
  });

  app.post<{ Body: Record<string, string> }>('/api/checkout', (req, reply) => {
    const s = bindSession(req, reply);
    const b = req.body ?? {};
    const str = (k: string) => String(b[k] ?? '').slice(0, 200);
    s.checkout = { name: str('name'), address: str('address'), card: str('card'), expiry: str('expiry') };
    return { valid: isValidCheckout(s.checkout) };
  });

  app.get<{ Querystring: { seed?: string } }>('/review', (req, reply) => {
    const seeded = req.query.seed === 'review';
    const s = bindSession(req, reply, seeded);
    if (seeded) {
      s.cart.push({ sku: 'eth', size: '250g', grind: 'whole' });
      s.checkout = { name: 'Ada Lovelace', address: 'Hauptstr. 1, 04109 Leipzig', card: '4242424242424242', expiry: '12/28' };
    }
    if (s.cart.length === 0 || !s.checkout || !isValidCheckout(s.checkout)) return reply.redirect('/checkout', 303);
    return html(reply, reviewPage(s));
  });

  app.post('/order', (req, reply) => {
    const s = bindSession(req, reply);
    if (s.cart.length === 0 || !s.checkout || !isValidCheckout(s.checkout)) return reply.redirect('/checkout', 303);
    s.orderPlaced = true;
    s.cart = [];
    return reply.redirect('/confirmation', 303);
  });

  app.get('/confirmation', (req, reply) => html(reply, confirmationPage(bindSession(req, reply))));

  return app;
}
