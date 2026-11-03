import { randomBytes } from 'node:crypto';
import type { StoreState } from '@earshot/shared';

export interface CartItem { sku: string; size: string; grind: string }
export interface CheckoutDetails { name: string; address: string; card: string; expiry: string }
export interface Session { id: string; cart: CartItem[]; checkout: CheckoutDetails | null; orderPlaced: boolean; createdAt: number }

export interface Product { sku: string; name: string; origin: string; notes: string; price: Record<string, number>; img: string }

export const PRODUCTS: Product[] = [
  { sku: 'eth', name: 'Ethiopia Guji', origin: 'Guji, Oromia', notes: 'Jasmine, bergamot, ripe peach', price: { '250g': 14.5, '500g': 26 }, img: '/img/eth.svg' },
  { sku: 'col', name: 'Colombia Huila', origin: 'Huila', notes: 'Red apple, panela, cocoa', price: { '250g': 12.9, '500g': 23.5 }, img: '/img/col.svg' },
  { sku: 'bra', name: 'Brasil Cerrado', origin: 'Cerrado Mineiro', notes: 'Hazelnut, milk chocolate', price: { '250g': 11.5, '500g': 21 }, img: '/img/bra.svg' },
];

export const GRINDS = [
  { id: 'whole', label: 'Whole bean' },
  { id: 'espresso', label: 'Espresso' },
  { id: 'filter', label: 'Filter' },
  { id: 'french-press', label: 'French press' },
];

export const SIZES = [
  { id: '250g', label: '250 g' },
  { id: '500g', label: '500 g' },
];

const MAX_SESSIONS = 5000;
const sessions = new Map<string, Session>();

export function createSession(): Session {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }
  const s: Session = { id: randomBytes(16).toString('hex'), cart: [], checkout: null, orderPlaced: false, createdAt: Date.now() };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string | undefined): Session | undefined {
  return id ? sessions.get(id) : undefined;
}

export function isValidCheckout(d: Partial<CheckoutDetails>): boolean {
  const card = (d.card ?? '').replace(/\s+/g, '');
  return !!d.name?.trim() && !!d.address?.trim() && /^4242\d{12}$/.test(card) && /^(0[1-9]|1[0-2])\/\d{2}$/.test((d.expiry ?? '').trim());
}

export function storeState(s: Session, page: StoreState['page'], grind: string | null = null): StoreState {
  return {
    page,
    grind,
    cart: s.cart.map((c) => ({ ...c })),
    checkoutValid: !!s.checkout && isValidCheckout(s.checkout),
    orderPlaced: s.orderPlaced,
  };
}
