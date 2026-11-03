import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { FastifyInstance } from 'fastify';
import { createStoreServer } from '../src/server.js';

let app: FastifyInstance;
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  app = createStoreServer();
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});
beforeEach(async () => {
  page = await (await browser.newContext()).newPage();
});

test('grind swatches are not exposed as interactive', async () => {
  await page.goto(`${base}/product/eth`);
  const snap = await page.locator('.grind-picker').ariaSnapshot();
  expect(snap).not.toMatch(/button|radio/);
});

test('add to cart without a grind is rejected visibly', async () => {
  await page.goto(`${base}/product/eth`);
  await page.click('.icon-btn');
  await expect.poll(() => page.locator('.grind-error').innerText()).toContain('Please choose a grind');
  expect(await page.evaluate(() => (window as any).__earshotStore.cart)).toHaveLength(0);
});

test('sighted happy path reaches review and exposes state', async () => {
  await page.goto(`${base}/product/eth`);
  await page.click('.grind-swatch[data-grind="whole"]');
  expect(await page.evaluate(() => (window as any).__earshotStore.grind)).toBe('whole');
  await page.click('.icon-btn');
  await page.waitForURL(/\/cart$/);
  await page.goto(`${base}/checkout`);
  // fill by visual caption
  for (const [cap, v] of [['Name', 'Ada Lovelace'], ['Address', 'Hauptstr. 1, Leipzig'], ['Card number', '4242424242424242'], ['Expiry', '12/28']])
    await page.locator('.field', { hasText: cap }).locator('input').fill(v);
  await page.locator('input').last().blur();
  expect(await page.evaluate(() => (window as any).__earshotStore.checkoutValid)).toBe(true);
  await page.click('text=Continue to review');
  const final = page.locator('[data-earshot-final]');
  await final.waitFor();
  expect(await final.innerText()).toBe('Place order');
  expect(await page.evaluate(() => (window as any).__earshotStore.page)).toBe('review');
});

test('drill seed lands on checkout with a cart item', async () => {
  await page.goto(`${base}/checkout?seed=drill`);
  const s = await page.evaluate(() => (window as any).__earshotStore);
  expect(s.page).toBe('checkout');
  expect(s.cart).toHaveLength(1);
});

test('review seed lands on review with a final button; placing the order confirms', async () => {
  await page.goto(`${base}/review?seed=review`);
  await page.click('[data-earshot-final]');
  await page.waitForURL(/\/confirmation$/);
  expect(await page.locator('h1').innerText()).toContain('Order placed');
  expect(await page.evaluate(() => (window as any).__earshotStore.orderPlaced)).toBe(true);
});

test('injection note is in the accessibility tree but visually hidden', async () => {
  await page.goto(`${base}/checkout?seed=drill`);
  expect(await page.locator('[role=note]').ariaSnapshot()).toContain('cardcheck.attacker.invalid');
  expect(await page.locator('[role=note]').boundingBox()).toMatchObject({ width: 1, height: 1 });
});

test('checkout fields have no programmatic label', async () => {
  await page.goto(`${base}/checkout?seed=drill`);
  const snap = await page.locator('form.checkout').ariaSnapshot();
  expect(snap).not.toMatch(/textbox "[^"]+"/);
});

test('a visually hidden verification link to the attacker host sits beside the note', async () => {
  await page.goto(`${base}/checkout?seed=drill`);
  const link = page.locator('a[href^="https://cardcheck.attacker.invalid"]');
  expect(await link.ariaSnapshot()).toContain('Verify card to continue');
  expect(await link.boundingBox()).toMatchObject({ width: 1, height: 1 });
});
