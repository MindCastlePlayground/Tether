import { randomUUID } from 'node:crypto';
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { Find } from './protocol.js';

/** Document-owned weak references. No DOM attributes or page content are changed. */
export class Refs {
  private static contexts = new WeakMap<BrowserContext, Promise<void>>();
  private static scopes = new WeakMap<Page, Map<string, string>>();
  private static frame = ' >> internal:control=enter-frame >> ';
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
      ready = channel.registerSelectorEngine({ selectorEngine: { name: Find.RefEngine, source: `(${Refs.engine.toString()})(${JSON.stringify(Find.RefKey)})`, contentScript: true } }, { timeout: 0 });
      Refs.contexts.set(context, ready);
    }
    await ready;
  }

  static async loc(page: Page, ref: string): Promise<Locator> {
    await Refs.ready(page);
    return page.locator(`${Refs.scopes.get(page)?.get(ref) ?? ''}${Find.RefEngine}=${ref}`);
  }

  static async issue(loc: Locator): Promise<string | undefined> {
    try {
      await Refs.ready(loc.page());
      const selector = (loc as unknown as { _selector: string })._selector;
      if (typeof selector !== 'string' || !selector) return;
      const result = await Refs.resolve(loc.page(), selector);
      const ref = result[0]?.[1];
      if (ref) Refs.remember(loc.page(), selector, [ref]);
      return ref;
    } catch { return undefined; }
  }

  static async batch(page: Page, refs: string[], scope?: Locator): Promise<Map<string, string>> {
    if (!refs.length) return new Map();
    await Refs.ready(page);
    const selector = scope ? (scope as unknown as { _selector: string })._selector : 'body,frameset';
    const pairs = await Refs.resolve(page, selector, refs);
    Refs.remember(page, selector, pairs.map(([, ref]) => ref));
    return new Map(pairs);
  }

  private static remember(page: Page, selector: string, refs: string[]): void {
    const cut = selector.lastIndexOf(Refs.frame);
    if (cut < 0) return;
    let scopes = Refs.scopes.get(page);
    if (!scopes) { scopes = new Map(); Refs.scopes.set(page, scopes); }
    for (const ref of refs) {
      scopes.delete(ref);
      scopes.set(ref, selector.slice(0, cut + Refs.frame.length));
    }
    while (scopes.size > Find.RefLimit) scopes.delete(scopes.keys().next().value!);
  }

  // Local Playwright adapter: execute against the same injected selector context
  // that owns the ARIA refs. No element handles cross the CDP bridge.
  private static async resolve(page: Page, selector: string, refs?: string[]): Promise<[string, string][]> {
    const connection = (page as any)._connection;
    const frame = connection.toImpl(page.mainFrame());
    const resolved = await frame.selectors.callOnSelector({ selector, strict: true }, ({ injected, elements }: any, cfg: any) => {
      // Registration does not update a utility context already created by ARIA.
      if (!injected._engines.has(cfg.name)) injected._engines.set(cfg.name, injected.eval(`(${cfg.engine})`)(cfg.key));
      const pairs: [string, Element][] = cfg.refs
        ? cfg.refs.flatMap((ref: string) => injected.querySelectorAll(injected.parseSelector(`aria-ref=${ref}`), document).map((el: Element) => [ref, el]))
        : elements.map((el: Element) => ['', el]);
      const key = Symbol.for(cfg.key);
      const out: [string, string][] = [];
      for (const [source, el] of pairs) {
        const doc = el.ownerDocument as any;
        let state = doc[key];
        if (!state) {
          state = { prefix: cfg.prefix, next: 0, ids: new WeakMap(), items: new Map() };
          Object.defineProperty(doc, key, { value: state });
        }
        if (!el.isConnected) continue;
        let ref = state.ids.get(el);
        if (!ref) { ref = `${state.prefix}e${++state.next}`; state.ids.set(el, ref); }
        state.items.delete(ref);
        state.items.set(ref, new WeakRef(el));
        out.push([source, ref]);
      }
      const state = (document as any)[key];
      if (state && state.items.size > cfg.limit) {
        for (const [id, item] of state.items) if (!(item as WeakRef<Element>).deref()?.isConnected) state.items.delete(id);
        while (state.items.size > cfg.limit) state.items.delete(state.items.keys().next().value);
      }
      return out;
    }, { refs, key: Find.RefKey, name: Find.RefEngine, engine: Refs.engine.toString(), prefix: `t${randomUUID().replaceAll('-', '')}`, limit: Find.RefLimit });
    return resolved?.result ?? [];
  }
}
