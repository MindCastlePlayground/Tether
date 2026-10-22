import type { Page, Locator } from 'playwright-core';
import { Find, FindCode, FindHint, Method, Strategy, type Params } from './protocol.js';

interface Info { role: string; name: string }
interface Try { sel: string; how: string; hint?: string }
/** A resolved element, or a refusal that guarantees nothing was executed. */
export type Resolved = { loc: Locator; how: string; hint?: string } | { fail: Params };

/** Turns one failed selector into stricter-to-looser alternatives an agent probably meant. */
export class Rewrite {
  static texts(sel: string): string[] {
    const out = [...sel.matchAll(Find.Quoted)].map(m => m[2].trim()).filter(Boolean);
    if (!out.length && !Find.Bare.test(sel) && sel.trim()) out.push(sel.trim());
    return [...new Set(out)];
  }
  static role(sel: string): string | undefined {
    return Find.Roles[sel.match(Find.Tag)?.[1]?.toLowerCase() ?? ''];
  }
  static q(text: string, exact: boolean): string { return JSON.stringify(text) + (exact ? 's' : 'i'); }
  static all(sel: string, method: string): Try[] {
    const list: Try[] = [{ sel, how: Strategy.Selector }];
    if (Find.XPath.test(sel) && sel.includes('text()')) list.push({ sel: sel.replaceAll('text()', 'normalize-space(.)'), how: Strategy.XPathText, hint: FindHint.XPathText });
    if (sel.includes(':contains(')) list.push({ sel: sel.replaceAll(':contains(', ':has-text('), how: Strategy.Contains, hint: FindHint.Fallback });
    const role = Rewrite.role(sel);
    for (const t of Rewrite.texts(sel)) {
      const add = (s: string, how: string) => list.push({ sel: s, how, hint: FindHint.Fallback });
      if (method === Method.Fill) {
        for (const exact of [true, false]) {
          add(`internal:label=${Rewrite.q(t, exact)}`, Strategy.Label);
          add(`internal:attr=[placeholder=${Rewrite.q(t, exact)}]`, Strategy.Placeholder);
          add(`internal:role=textbox[name=${Rewrite.q(t, exact)}]`, Strategy.Role);
        }
        continue;
      }
      for (const exact of [true, false]) {
        if (role) add(`internal:role=${role}[name=${Rewrite.q(t, exact)}]`, Strategy.Role);
        add(`internal:text=${Rewrite.q(t, exact)}`, Strategy.Text);
      }
    }
    return list;
  }
}

/** Compacts Playwright's AI aria snapshot and remembers role/name per ref. */
export class Snapshot {
  static parse(raw: string): Map<string, Info> {
    const refs = new Map<string, Info>();
    for (const line of raw.split('\n')) {
      const m = line.match(Find.Line);
      if (!m) continue;
      let name = '';
      try { name = m[2] ? JSON.parse(`"${m[2]}"`) : ''; } catch { name = m[2] ?? ''; }
      refs.set(m[3], { role: m[1], name });
    }
    return refs;
  }
  /** Drops unnamed generic wrappers (div/span soup) and lifts their children. */
  static compact(raw: string): string {
    const out: string[] = [];
    const dropped: number[] = [];
    for (const line of raw.split('\n')) {
      const indent = line.length - line.trimStart().length;
      while (dropped.length && indent <= dropped[dropped.length - 1]) dropped.pop();
      if (Find.Leaf.test(line)) continue;
      if (Find.Container.test(line)) { dropped.push(indent); continue; }
      out.push(' '.repeat(Math.max(0, indent - dropped.length * 2)) + line.trimStart());
    }
    return out.join('\n');
  }
  static cut(tree: string, max: number): { tree: string; truncated: boolean } {
    if (tree.length <= max) return { tree, truncated: false };
    const end = tree.lastIndexOf('\n', max);
    return { tree: tree.slice(0, end > 0 ? end : max), truncated: true };
  }
}

/** Snapshot, precise locator lookup and tolerant resolution for one Playwright page. */
export class Finder {
  private static refs = new WeakMap<Page, Map<string, Info>>();
  private static wait(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
  private static async count(loc: Locator): Promise<number> { try { return await loc.count(); } catch { return -1; } }

  static async snapshot(page: Page, p: Params): Promise<Params> {
    const depth = Number.isInteger(p.depth) && p.depth > 0 ? p.depth : undefined;
    let raw: string;
    if (p.scope) {
      const scope = page.locator(p.scope);
      if (await Finder.count(scope) !== 1) return { sideEffect: 'none', error: FindCode.Scope, hint: FindHint.Missing };
      raw = await scope.ariaSnapshot({ mode: Find.AI, depth });
    } else raw = await page.ariaSnapshot({ mode: Find.AI, depth });
    const refs = Snapshot.parse(raw);
    Finder.refs.set(page, refs);
    const max = Number.isInteger(p.maxChars) && p.maxChars > 0 ? Math.min(p.maxChars, Find.Chars) : Find.Chars;
    const { tree, truncated } = Snapshot.cut(Snapshot.compact(raw), max);
    return { url: page.url(), title: await page.title(), tree, refs: refs.size, truncated, hint: FindHint.Snapshot, sideEffect: 'none' };
  }

  /** Lists every element a query matches, each with a verified unique selector and its actionable target. */
  static async locate(page: Page, p: Params): Promise<Params> {
    let loc: Locator | undefined;
    if (p.ref) {
      const r = await Finder.byRef(page, p.ref);
      if ('fail' in r) return r.fail;
      loc = r.loc;
    } else if (p.selector) loc = page.locator(p.selector);
    else if (p.role) loc = page.locator(`internal:role=${p.role}` + (p.name ?? p.text ? `[name=${Rewrite.q(p.name ?? p.text, !!p.exact)}]` : ''));
    else if (p.text) loc = page.locator(`internal:text=${Rewrite.q(p.text, !!p.exact)}`);
    if (!loc) return { sideEffect: 'none', error: FindCode.Query };
    const total = await Finder.count(loc);
    if (total < 0) return { sideEffect: 'none', error: FindCode.Invalid, hint: FindHint.Invalid };
    const candidates = await Finder.list(loc, total);
    await Finder.restore(page);
    return { count: total, candidates, sideEffect: 'none', ...(total ? {} : { hint: FindHint.Missing }) };
  }

  /** Resolves a ref or selector to exactly one element before any side effect happens. */
  static async resolve(page: Page, p: Params, method: string): Promise<Resolved> {
    let r = p.ref ? await Finder.byRef(page, p.ref) : await Finder.bySelector(page, p.selector, method);
    if (!('fail' in r)) r = method === Method.Fill ? await Finder.field(r) : await Finder.actionable(r);
    if ('fail' in r) await Finder.restore(page);
    return r;
  }

  /** Describes the element that is about to be acted on without invalidating the agent's refs. */
  static async target(page: Page, loc: Locator): Promise<Params> {
    const d = await Finder.describe(loc);
    await Finder.restore(page);
    return d;
  }

  /**
   * Any default aria snapshot or normalize() replaces the frame's ref table. Refs are cached per element,
   * so re-taking the AI snapshot brings back the same refs the agent already holds.
   */
  static async restore(page: Page): Promise<void> {
    const old = Finder.refs.get(page);
    if (!old) return;
    try {
      const fresh = Snapshot.parse(await page.ariaSnapshot({ mode: Find.AI }));
      Finder.refs.set(page, new Map([...old, ...fresh]));
    } catch {}
  }

  private static async byRef(page: Page, ref: string): Promise<Resolved> {
    const direct = page.getByRef(ref);
    if (await Finder.count(direct) === 1) return { loc: direct, how: Strategy.Ref };
    const info = Finder.refs.get(page)?.get(ref);
    if (info?.name) {
      const loc = page.locator(`internal:role=${info.role}[name=${Rewrite.q(info.name, true)}]`);
      if (await Finder.count(loc) === 1) return { loc, how: Strategy.RefRole, hint: FindHint.Stale };
    }
    return { fail: { sideEffect: 'none', error: FindCode.Stale, hint: FindHint.Stale, ...(info ? { expected: info } : {}) } };
  }

  private static async bySelector(page: Page, sel: string, method: string): Promise<Resolved> {
    const tries = Rewrite.all(sel, method);
    const end = Date.now() + Find.Wait;
    let invalid = true;
    for (;;) {
      for (const t of tries) {
        const loc = page.locator(t.sel);
        const n = await Finder.count(loc);
        if (n >= 0) invalid = false;
        if (n === 1) return { loc, how: t.how, hint: t.hint };
        if (n < 2) continue;
        const shown = await Finder.visible(loc, n);
        if (shown.length === 1) return { loc: shown[0], how: t.how + Strategy.Visible, hint: t.hint };
        if (shown.length > 1) return { fail: { sideEffect: 'none', error: FindCode.Ambiguous, hint: FindHint.Ambiguous, strategy: t.how, count: n, candidates: await Finder.list(loc, n) } };
      }
      if (invalid || Date.now() >= end) break;
      await Finder.wait(Find.Step);
    }
    if (invalid) return { fail: { sideEffect: 'none', error: FindCode.Invalid, hint: FindHint.Invalid } };
    const suggestions: Params[] = [];
    for (const t of Rewrite.texts(sel)) {
      const loc = page.locator(`internal:text=${Rewrite.q(t.slice(0, Find.Name), false)}`);
      suggestions.push(...await Finder.list(loc, await Finder.count(loc)));
      if (suggestions.length >= Find.Candidates) break;
    }
    return { fail: { sideEffect: 'none', error: FindCode.Missing, hint: FindHint.Missing, tried: tries.map(t => t.how), candidates: suggestions.slice(0, Find.Candidates) } };
  }

  private static async visible(loc: Locator, n: number): Promise<Locator[]> {
    const out: Locator[] = [];
    for (let i = 0; i < Math.min(n, Find.Visible); i++) if (await loc.nth(i).isVisible().catch(() => false)) out.push(loc.nth(i));
    return out;
  }

  /** Moves a match on nested text (span inside a button) to the control that receives the click. */
  private static async actionable(r: { loc: Locator; how: string; hint?: string }): Promise<Resolved> {
    const up = r.loc.locator(Find.Actionable);
    if (await Finder.count(up) !== 1) return r;
    const same = await r.loc.evaluate((e, a) => e === a, await up.elementHandle()).catch(() => true);
    return same ? r : { loc: up, how: r.how + Strategy.Retarget, hint: r.hint ?? FindHint.Retarget };
  }

  private static async field(r: { loc: Locator; how: string; hint?: string }): Promise<Resolved> {
    const ok = await r.loc.evaluate(e => ['INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].includes(e.tagName) || (e as HTMLElement).isContentEditable).catch(() => false);
    if (ok) return r;
    const inner = r.loc.locator(Find.Fillable);
    if (await Finder.count(inner) === 1) return { loc: inner, how: r.how + Strategy.Inner, hint: r.hint };
    return { fail: { sideEffect: 'none', error: FindCode.Fill, hint: FindHint.Fill, target: await Finder.describe(r.loc) } };
  }

  private static async list(loc: Locator, n: number): Promise<Params[]> {
    const out: Params[] = [];
    for (let i = 0; i < Math.min(Math.max(n, 0), Find.Candidates); i++) {
      const item = n === 1 ? loc : loc.nth(i);
      const d = await Finder.describe(item);
      const act = await Finder.actionable({ loc: item, how: '' });
      if ('loc' in act && act.loc !== item) d.actionable = await Finder.describe(act.loc);
      out.push(d);
    }
    return out;
  }

  /** Role, name and a selector verified to match only this element. */
  static async describe(loc: Locator): Promise<Params> {
    const out: Params = {};
    try {
      const line = (await loc.ariaSnapshot({ depth: 1 })).split('\n')[0];
      const m = line.match(Find.Head);
      if (m) { out.role = m[1]; if (m[2]) out.name = JSON.parse(`"${m[2]}"`).slice(0, Find.Name); }
    } catch {}
    try {
      const e = await loc.evaluate(el => ({ tag: el.tagName.toLowerCase(), visible: !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === 'fixed', text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() }));
      out.tag = e.tag; out.visible = e.visible;
      if (!out.name && e.text) out.text = e.text.slice(0, Find.Name);
    } catch {}
    out.selector = await Finder.unique(loc, out);
    return out;
  }

  private static async unique(loc: Locator, d: Params): Promise<string | undefined> {
    const page = loc.page();
    const options: string[] = [];
    try { options.push((await loc.normalize() as unknown as { _selector: string })._selector); } catch {}
    if (d.role && d.name) options.push(`internal:role=${d.role}[name=${Rewrite.q(d.name, true)}]`);
    for (const s of options) if (s && await Finder.count(page.locator(s)) === 1) return s;
    const base = (loc as unknown as { _selector?: string })._selector;
    return base;
  }
}
