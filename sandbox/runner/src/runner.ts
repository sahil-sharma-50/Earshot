import { createHash } from 'node:crypto';
import type { Action, AgentKind, Probe, RpcRequest, StoreState } from '@earshot/shared';
import { BrowserSession } from './browser.js';
import { observeAx, type BlindRef } from './blind.js';
import { act, actOnNode, type TargetLookup } from './act.js';
import { backendIdForSelector, identify } from './identity.js';
import { focusedBackendId, markBackendId, observeSighted } from './sighted.js';

export class Runner {
  readonly browser: BrowserSession;
  blindRefs = new Map<string, BlindRef>();

  constructor(browser = new BrowserSession()) {
    this.browser = browser;
  }

  lookup(kind: AgentKind): TargetLookup {
    return async (target) => {
      const { cdp } = this.browser.requirePage();
      if (target === 'focused') {
        const id = await focusedBackendId(cdp);
        return id === null ? { error: 'unknown-target' } : { backendNodeId: id, actionable: true };
      }
      if (kind === 'blind') {
        const r = this.blindRefs.get(target);
        return r ? { backendNodeId: r.backendNodeId, actionable: r.actionable } : { error: 'unknown-target' };
      }
      // sighted: anything that LOOKED interactive was marked, so every mark is actionable
      const id = /^\d+$/.test(target) ? await markBackendId(cdp, Number(target)) : null;
      return id === null ? { error: 'unknown-target' } : { backendNodeId: id, actionable: true };
    };
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
        const { screenshotPng, marks } = await observeSighted(page);
        return { kind: 'sighted', url: page.url(), title: await page.title(), screenshotPng, marks };
      }
      case 'act': {
        const { page, cdp } = this.browser.requirePage();
        return act(page, cdp, req.action, this.lookup(req.kind));
      }
      case 'describe': {
        const { cdp } = this.browser.requirePage();
        const t = await this.lookup(req.kind)(req.target);
        if ('error' in t) throw new Error(t.error);
        return identify(cdp, t.backendNodeId);
      }
      case 'replay':
        return this.replay(req.actions);
      case 'probe':
        return this.probe();
      case 'close':
        await this.shutdown();
        return { closed: true };
      default:
        throw new Error(`unsupported method: ${(req as { m: string }).m}`);
    }
  }

  /** Re-executes recorded actions by cssPath; stops at the first failure. */
  async replay(actions: { cssPath: string; action: Action }[]): Promise<{ replayed: number }> {
    const { page, cdp } = this.browser.requirePage();
    let n = 0;
    for (const { cssPath, action } of actions) {
      let ok: boolean;
      if (action.type === 'click' || action.type === 'type' || action.type === 'select') {
        const id = await backendIdForSelector(cdp, cssPath).catch(() => null);
        ok = id !== null && (await actOnNode(page, cdp, id, action)).ok;
      } else {
        ok = (await act(page, cdp, action, async () => ({ error: 'unknown-target' }))).ok;
      }
      if (!ok) break;
      n++;
    }
    return { replayed: n };
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
