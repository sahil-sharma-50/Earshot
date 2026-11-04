import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import type { Patch } from '@earshot/shared';

export const VIEWPORT = { width: 1280, height: 800 };

/** One Chromium per runner; one fresh context per `open` (a clean store session every time). */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  page: Page | null = null;
  cdp: CDPSession | null = null;

  constructor(private readonly proxy = process.env.EARSHOT_PROXY) {}

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        proxy: this.proxy ? { server: this.proxy } : undefined,
        args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync'],
      });
    }
    return this.browser;
  }

  /** Opens `url` in a fresh context. `bindings` are page-callable functions, exposed before any page script runs. */
  async open(url: string, initScript?: string, bindings: Record<string, (data: unknown) => void> = {}): Promise<{ url: string; title: string }> {
    const browser = await this.ensureBrowser();
    await this.context?.close().catch(() => {});
    this.context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', serviceWorkers: 'block' });
    for (const [name, fn] of Object.entries(bindings)) await this.context.exposeBinding(name, (_source, data: unknown) => fn(data));
    // Functions we serialise into the page may carry esbuild's __name() helper (tsx/dev builds).
    await this.context.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
    if (initScript) await this.context.addInitScript({ content: initScript });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(10_000);
    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send('DOM.enable');
    await this.cdp.send('Accessibility.enable');
    await this.page.goto(url, { waitUntil: 'load', timeout: 20_000 });
    return { url: this.page.url(), title: await this.page.title() };
  }

  requirePage(): { page: Page; cdp: CDPSession } {
    if (!this.page || !this.cdp) throw new Error('no page open');
    return { page: this.page, cdp: this.cdp };
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
    this.cdp = null;
  }
}

/** Waits briefly for any navigation or re-render an action triggered. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  // handlers that fetch() and then navigate start the navigation late: wait for the network to go quiet
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => {});
}

export type { Patch };
