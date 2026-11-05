import { createHash } from 'node:crypto';
import { applierSource, PATCH_REPORT_BINDING, PatchTracker, readPatchReport, READ_ONLY_METHODS, type Action, type AgentKind, type Probe, type RpcRequest, type StoreState } from '@earshot/shared';
import { BrowserSession } from './browser.js';
import { observeAx, type BlindRef } from './blind.js';
import { act, actOnNode, type TargetLookup } from './act.js';
import { backendIdForSelector, identify } from './identity.js';
import { focusedBackendId, markBackendId, observeSighted } from './sighted.js';
import { inspect } from './inspect.js';

export class Runner {
  readonly browser: BrowserSession;
  blindRefs = new Map<string, BlindRef>();
  /** What the patches did across every page since the last `open`. */
  private patches = new PatchTracker([]);

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

  /** Read-only calls are retried when they race a navigation; actions never are (they could run twice). */
  async handle(req: RpcRequest): Promise<unknown> {
    const readOnly = READ_ONLY_METHODS[req.m] === true;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.dispatch(req);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        const race = /Execution context was destroyed|Cannot find context|navigat|Timeout \d+ms exceeded|frame was detached|Target page, context or browser has been closed/i.test(msg);
        if (!readOnly || !race || attempt >= 2 || !this.browser.page) throw e;
        await this.browser.page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
        await this.browser.page.waitForTimeout(200);
      }
    }
  }

  private async dispatch(req: RpcRequest): Promise<unknown> {
    switch (req.m) {
      case 'open': {
        this.blindRefs.clear();
        const tracker = new PatchTracker(req.patches ?? []);
        this.patches = tracker;
        if (!req.patches?.length) return this.browser.open(req.url);
        // every patched page reports as it goes, including pages a single action only passes through
        return this.browser.open(req.url, applierSource(req.patches), { [PATCH_REPORT_BINDING]: (r) => tracker.merge(r) });
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
      case 'inspect': {
        const { page, cdp } = this.browser.requirePage();
        return inspect(page, cdp, req.cssPath);
      }
      case 'patchStatus': {
        // pushed reports cover every page visited; one last read of the current page covers a push still in flight
        this.patches.merge(await this.browser.page?.evaluate(readPatchReport).catch(() => undefined));
        return this.patches.report();
      }
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
