import { randomUUID } from 'node:crypto';
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { Find } from './protocol.js';

/** Document-owned weak references. No DOM attributes or page content are changed. */
export class Refs {
  private static contexts = new WeakMap<BrowserContext, Promise<void>>();
  private static engine = (key: string) => ({
    query(root: Document | Element, ref: string) { return this.queryAll(root, ref)[0] ?? null; },
    queryAll(root: Document | Element, ref: string) {
      const doc = root.ownerDocument ?? root;
      const state = (doc as any)[Symbol.for(key)];
      const el = state?.items.get(ref)?.deref();
      return el?.isConnected && el.ownerDocument === doc && (root === doc || root.contains(el)) ? [el] : [];
    },
  });

  private static async ready(page: Page): Promise<void> {
    const context = page.context();
    let ready = Refs.contexts.get(context);
    if (!ready) {
      // Playwright 1.64 does not copy global selector engines to an existing CDP
      // default context. Register on the owned context, including TabTransport.
      const channel = (context as unknown as { _channel: { registerSelectorEngine(p: unknown, o: unknown): Promise<void> } })._channel;
      ready = channel.registerSelectorEngine({ selectorEngine: { name: Find.RefEngine, source: `(${Refs.engine.toString()})(${JSON.stringify(Find.RefKey)})`, contentScript: false } }, { timeout: 0 });
      Refs.contexts.set(context, ready);
    }
    await ready;
  }

  static async loc(page: Page, ref: string): Promise<Locator> {
    await Refs.ready(page);
    return page.locator(`${Find.RefEngine}=${ref}`);
  }

  static async issue(loc: Locator): Promise<string | undefined> {
    await Refs.ready(loc.page());
    const handle = await loc.elementHandle().catch(() => null);
    if (!handle) return undefined;
    try { return await loc.page().evaluate(({el, cfg}) => {
      const key = Symbol.for(cfg.key);
      const doc = el.ownerDocument as any;
      let state = doc[key];
      if (!state) {
        state = { prefix: cfg.prefix, next: 0, ids: new WeakMap(), items: new Map() };
        Object.defineProperty(doc, key, { value: state });
      }
      if (!el.isConnected) return undefined;
      let ref = state.ids.get(el);
      if (!ref) { ref = `${state.prefix}e${++state.next}`; state.ids.set(el, ref); }
      state.items.delete(ref);
      state.items.set(ref, new WeakRef(el));
      if (state.items.size > cfg.limit) {
        for (const [id, item] of state.items) if (!(item as WeakRef<Element>).deref()?.isConnected) state.items.delete(id);
        while (state.items.size > cfg.limit) state.items.delete(state.items.keys().next().value);
      }
      return ref as string;
    }, { el: handle, cfg: { key: Find.RefKey, prefix: `t${randomUUID().replaceAll('-', '')}`, limit: Find.RefLimit } }).catch(() => undefined); }
    finally { await handle.dispose(); }
  }
}
