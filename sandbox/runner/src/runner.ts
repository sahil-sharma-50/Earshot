import { createHash } from 'node:crypto';
import type { Action, AgentKind, Probe, RpcRequest, StoreState } from '@earshot/shared';
import { BrowserSession } from './browser.js';
import { observeAx, type BlindRef } from './blind.js';
import { act, actOnNode, type TargetLookup } from './act.js';
import { backendIdForSelector, identify } from './identity.js';
import { focusedBackendId, markBackendId, observeSighted } from './sighted.js';
import { inspect } from './inspect.js';
import { applierSource } from './patch-applier.js';

export class Runner {
  readonly browser: BrowserSession;
  blindRefs = new Map<string, BlindRef>();
  /** Highest patch match count seen per finding across every page of this session. */
  private patchMatches: Record<string, number> = {};

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
        this.patchMatches = {};
        const opened = await this.browser.open(req.url, req.patches?.length ? applierSource(req.patches) : undefined);
        await this.recordPatchMatches();
        return opened;
      }
      case 'observe': {
        const { page, cdp } = this.browser.requirePage();
        await this.recordPatchMatches();
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
        await this.recordPatchMatches(); // the action may navigate away from the patched page
        return act(page, cdp, req.action, this.lookup(req.kind));
      }
      case 'describe': {
        const { cdp } = this.browser.requirePage();
        const t = await this.lookup(req.kind)(req.target);
        if ('error' in t) throw new Error(t.error);
        return identify(cdp, t.backendNodeId);
      }
      case 'inspect': {
        const { page, cdp } = this.browser.requirePage();
        return inspect(page, cdp, req.cssPath);
      }
      case 'patchStatus':
        await this.recordPatchMatches();
        return { ...this.patchMatches };
      case 'axSpeech': {
        const { cdp } = this.browser.requirePage();
        let root: number | undefined;
        if (req.cssPath) {
          const id = await backendIdForSelector(cdp, req.cssPath);
          if (id === null) throw new Error(`element not found: ${req.cssPath}`);
          root = id;
        }
        return (await observeAx(cdp, root)).nodes;
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

  private async recordPatchMatches(): Promise<void> {
    const page = this.browser.page;
    if (!page) return;
    const now = await page.evaluate(() => (window as unknown as { __earshotPatchMatches?: Record<string, number> }).__earshotPatchMatches ?? {}).catch(() => ({}) as Record<string, number>);
    for (const [k, v] of Object.entries(now)) this.patchMatches[k] = Math.max(this.patchMatches[k] ?? 0, v);
  }

  async probe(): Promise<Probe> {
    const { page } = this.browser.requirePage();
    const r = await page.evaluate(() => ({
      url: location.href,
      text: document.body ? document.body.innerText : '',
      fields: Array.from(document.querySelectorAll('input,select,textarea')).map((el) => {
        const f = el as HTMLInputElement;
        return f.type === 'checkbox' || f.type === 'radio' ? String(f.checked) : f.value;
      }).join(''),
      store: ((window as unknown as { __earshotStore?: unknown }).__earshotStore ?? null),
    }));
    // page text + URL + form values + store mirror: typing or picking an option counts as progress
    const domHash = createHash('sha1').update(r.text + r.url + r.fields + JSON.stringify(r.store)).digest('hex');
    return { url: r.url, domHash, store: r.store as StoreState | null };
  }

  async shutdown(): Promise<void> {
    await this.browser.close();
  }
}
