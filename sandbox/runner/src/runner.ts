import { createHash } from 'node:crypto';
import type { AgentKind, Probe, RpcRequest, StoreState } from '@earshot/shared';
import { BrowserSession } from './browser.js';
import { observeAx, type BlindRef } from './blind.js';
import { act, type TargetLookup } from './act.js';
import { identify } from './identity.js';

export class Runner {
  readonly browser: BrowserSession;
  blindRefs = new Map<string, BlindRef>();

  constructor(browser = new BrowserSession()) {
    this.browser = browser;
  }

  lookup(kind: AgentKind): TargetLookup {
    if (kind === 'blind') {
      return (target) => {
        const r = this.blindRefs.get(target);
        return r ? { backendNodeId: r.backendNodeId, actionable: r.actionable } : { error: 'unknown-target' };
      };
    }
    throw new Error('sighted targets not supported');
  }

  async handle(req: RpcRequest): Promise<unknown> {
    switch (req.m) {
      case 'open': {
        this.blindRefs.clear();
        return this.browser.open(req.url);
      }
      case 'observe': {
        const { page, cdp } = this.browser.requirePage();
        if (req.kind === 'blind') {
          const { nodes, refs } = await observeAx(cdp);
          this.blindRefs = refs;
          return { kind: 'blind', url: page.url(), title: await page.title(), nodes };
        }
        throw new Error('sighted observe not supported');
      }
      case 'act': {
        const { page, cdp } = this.browser.requirePage();
        return act(page, cdp, req.action, this.lookup(req.kind));
      }
      case 'describe': {
        const { cdp } = this.browser.requirePage();
        const t = this.lookup(req.kind)(req.target);
        if ('error' in t) throw new Error(t.error);
        return identify(cdp, t.backendNodeId);
      }
      case 'probe':
        return this.probe();
      case 'close':
        await this.shutdown();
        return { closed: true };
      default:
        throw new Error(`unsupported method: ${(req as { m: string }).m}`);
    }
  }

  async probe(): Promise<Probe> {
    const { page } = this.browser.requirePage();
    const r = await page.evaluate(() => ({
      url: location.href,
      text: document.body ? document.body.innerText : '',
      store: ((window as unknown as { __earshotStore?: unknown }).__earshotStore ?? null),
    }));
    const domHash = createHash('sha1').update(r.text + r.url).digest('hex');
    return { url: r.url, domHash, store: r.store as StoreState | null };
  }

  async shutdown(): Promise<void> {
    await this.browser.close();
  }
}
