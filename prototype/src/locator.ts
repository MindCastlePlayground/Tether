import type { Page, Locator } from 'playwright-core';
import { Refs } from './refs.js';
import { Find, FindCode, FindHint, Method, Strategy, type Params } from './protocol.js';

interface Info { role: string; name: string }
interface Try { sel: string; how: string; hint?: string }
/** A resolved element, or a refusal that guarantees nothing was executed. */
export type Resolved = { loc: Locator; how: string; hint?: string } | { fail: Params };

/** Supports a small set of local rewrites without dropping selector constraints. */
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
  static contains(sel: string): string | undefined {
    let out = '', quote = '', brackets = 0, changed = false;
    for (let i = 0; i < sel.length; i++) {
      const c = sel[i];
      if (c === '\\') { out += sel.slice(i, i + 2); i++; continue; }
      if (quote) { out += c; if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; out += c; continue; }
      if (c === '[') brackets++;
      if (c === ']') brackets--;
      if (!brackets && sel.startsWith(':contains(', i)) { out += ':has-text('; i += 9; changed = true; }
      else out += c;
    }
    return changed && !quote && brackets === 0 ? out : undefined;
  }
  static all(sel: string, method: string): Try[] {
    const list: Try[] = [{ sel, how: Strategy.Selector }];
    // Only a simple predicate can be rewritten without changing unrelated text() expressions.
    if (/^(?:xpath=)?\/\/[\w-]+(?:\[@[\w-]+=["'][^"']*["']\])*\[(?:text\(\)\s*=\s*["'][^"']*["']|contains\(text\(\),\s*["'][^"']*["']\))\]$/.test(sel)) list.push({ sel: sel.replace('text()', 'normalize-space(.)'), how: Strategy.XPathText, hint: FindHint.XPathText });
    const contains = Rewrite.contains(sel);
    if (contains) list.push({ sel: contains, how: Strategy.Contains, hint: FindHint.Fallback });
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
    return { tree: end > 0 ? tree.slice(0, end) : '', truncated: true };
  }
}

/** Snapshot, precise locator lookup and tolerant resolution for one Playwright page. */
export class Finder {
  private static wait(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
  private static async count(loc: Locator): Promise<number> { try { return await loc.count(); } catch { return -1; } }

  private static async scope(page: Page, p: Params): Promise<Resolved | undefined> {
    if (p.scope !== undefined && p.scopeRef !== undefined) return { fail: { sideEffect: 'none', error: FindCode.ScopeConflict, hint: FindHint.Scope } };
    if (p.scopeRef) return Finder.byRef(page, p.scopeRef);
    if (!p.scope) return undefined;
    const loc = page.locator(p.scope);
    const n = await Finder.count(loc);
    if (n !== 1) return { fail: { sideEffect: 'none', error: n > 1 ? FindCode.ScopeMany : n < 0 ? FindCode.Invalid : FindCode.Scope, hint: FindHint.Scope } };
    return { loc, how: Strategy.Selector };
  }

  static async snapshot(page: Page, p: Params): Promise<Params> {
    const scope = await Finder.scope(page, p);
    if (scope && 'fail' in scope) return scope.fail;
    const depth = Number.isInteger(p.depth) && p.depth > 0 ? p.depth : undefined;
    const raw = await (scope ? scope.loc : page).ariaSnapshot({ mode: Find.AI, depth });
    let tree = Snapshot.compact(raw);
    if (p.outline) {
      const lines = tree.split('\n');
      const selected = lines.filter(line => { const m = line.match(Find.Line); return m && Find.Outline.has(m[1]); });
      // Pages without landmarks still have usable top-level controls.
      tree = (selected.length ? selected : lines.filter(line => line.startsWith('- '))).join('\n');
    }
    const max = Number.isInteger(p.maxChars) && p.maxChars > 0 ? Math.min(p.maxChars, Find.Chars) : Find.Chars;
    const first = Snapshot.cut(tree, max);
    const refs = Snapshot.parse(first.tree);
    const mapped = new Map(await Promise.all([...refs.keys()].map(async ref => [ref, await Refs.issue(page.getByRef(ref))] as const)));
    tree = first.tree.replace(/\[ref=([a-z0-9]+)\]/g, (_, ref) => mapped.get(ref) ? `[ref=${mapped.get(ref)}]` : '');
    const result = Snapshot.cut(tree, max);
    const truncated = first.truncated || result.truncated;
    return { url: page.url(), title: await page.title(), tree: result.tree, refs: Snapshot.parse(result.tree).size,
      truncated, hint: truncated ? FindHint.Truncated : FindHint.Snapshot, sideEffect: 'none' };
  }

  static async locate(page: Page, p: Params): Promise<Params> {
    const scope = await Finder.scope(page, p);
    if (scope && 'fail' in scope) return scope.fail;
    const root = scope ? scope.loc : page;
    let loc: Locator | undefined;
    if (p.ref) {
      const r = await Finder.byRef(page, p.ref);
      if ('fail' in r) return r.fail;
      loc = r.loc;
      if (scope) {
        const within = await scope.loc.evaluate((el, target) => el.contains(target), await loc.elementHandle());
        if (!within) return { count: 0, shown: 0, truncated: false, candidates: [], sideEffect: 'none', hint: FindHint.Missing };
      }
    } else if (p.selector) loc = root.locator(p.selector);
    else if (p.role) loc = root.locator(`internal:role=${p.role}` + (p.name ?? p.text ? `[name=${Rewrite.q(p.name ?? p.text, !!p.exact)}]` : ''));
    else if (p.text) loc = root.locator(`internal:text=${Rewrite.q(p.text, !!p.exact)}`);
    if (!loc) return { sideEffect: 'none', error: FindCode.Query };
    const total = await Finder.count(loc);
    if (total < 0) return { sideEffect: 'none', error: FindCode.Invalid, hint: FindHint.Invalid };
    const candidates = await Finder.list(loc, total);
    return { count: total, shown: candidates.length, truncated: total > candidates.length, candidates, sideEffect: 'none',
      ...(total > candidates.length ? { hint: FindHint.Truncated } : total ? {} : { hint: FindHint.Missing }) };
  }

  /** Resolves a ref or selector to exactly one element before any side effect happens. */
  static async resolve(page: Page, p: Params, method: string): Promise<Resolved> {
    let r = p.ref ? await Finder.byRef(page, p.ref) : await Finder.bySelector(page, p.selector, method);
    if (!('fail' in r)) r = method === Method.Fill ? await Finder.field(r) : await Finder.actionable(r);
    return r;
  }

  static async target(page: Page, loc: Locator): Promise<Params> { return Finder.describe(loc); }

  private static async byRef(page: Page, ref: string): Promise<Resolved> {
    const loc = await Refs.loc(page, ref);
    if (await Finder.count(loc) === 1) return { loc, how: Strategy.Ref };
    return { fail: { sideEffect: 'none', error: FindCode.Stale, hint: FindHint.Stale } };
  }

  /** Pin identity before checking visibility or acting; never retain a moving nth() locator. */
  private static async pin(loc: Locator): Promise<Locator | undefined> {
    const ref = await Refs.issue(loc);
    return ref ? Refs.loc(loc.page(), ref) : undefined;
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
        if (n === 1) { const pinned = await Finder.pin(loc); if (pinned) return { loc: pinned, how: t.how, hint: t.hint }; }
        if (n < 2) continue;
        const shown = await Finder.visible(loc, n);
        if (shown === undefined) return { fail: { sideEffect: 'none', error: FindCode.Unchecked, hint: FindHint.Ambiguous } };
        if (shown.length === 1) return { loc: shown[0], how: t.how + Strategy.Visible, hint: t.hint };
        if (shown.length > 1) return { fail: { sideEffect: 'none', error: FindCode.Ambiguous, hint: FindHint.Ambiguous, strategy: t.how, count: n, shown: Math.min(n, Find.Candidates), truncated: n > Find.Candidates, candidates: await Finder.list(loc, n) } };
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

  private static async visible(loc: Locator, n: number): Promise<Locator[] | undefined> {
    const out: Locator[] = [];
    // Resolve the complete set at once, then inspect the same element identities.
    const handles = await loc.elementHandles().catch(() => undefined);
    if (!handles) return undefined;
    try {
      if (handles.length !== n) return undefined;
      for (const handle of handles) {
        if (!await handle.evaluate(el => el.isConnected)) return undefined;
        if (!await handle.isVisible()) continue;
        // Pin via identity, then verify that the candidate has not moved since lookup.
        const index = handles.indexOf(handle);
        const pinned = await Finder.pin(loc.nth(index));
        if (!pinned || !await pinned.evaluate((el, original) => el === original, handle)) return undefined;
        out.push(pinned);
      }
      if (await loc.count() !== n) return undefined;
      return out;
    } catch { return undefined; }
    finally { await Promise.all(handles.map(h => h.dispose())); }
  }

  /** Moves a match on nested text (span inside a button) to the control that receives the click. */
  private static async actionable(r: { loc: Locator; how: string; hint?: string }): Promise<Resolved> {
    const up = r.loc.locator(Find.Actionable);
    if (await Finder.count(up) !== 1) return r;
    const handle = await up.elementHandle();
    let same: boolean;
    try { same = await r.loc.evaluate((e, a) => e === a, handle); } finally { await handle?.dispose(); }
    if (same) return r;
    const loc = await Finder.pin(up);
    return loc ? { loc, how: r.how + Strategy.Retarget, hint: r.hint ?? FindHint.Retarget } : { fail: { sideEffect: 'none', error: FindCode.Stale, hint: FindHint.Stale } };
  }

  private static async field(r: { loc: Locator; how: string; hint?: string }): Promise<Resolved> {
    const ok = await r.loc.evaluate(e => ['INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].includes(e.tagName) || (e as HTMLElement).isContentEditable).catch(() => false);
    if (ok) return r;
    const inner = r.loc.locator(Find.Fillable);
    if (await Finder.count(inner) === 1) {
      const loc = await Finder.pin(inner);
      if (loc) return { loc, how: r.how + Strategy.Inner, hint: r.hint };
    }
    return { fail: { sideEffect: 'none', error: FindCode.Fill, hint: FindHint.Fill, target: await Finder.describe(r.loc) } };
  }

  private static async list(loc: Locator, n: number): Promise<Params[]> {
    const out: Params[] = [];
    for (let i = 0; i < Math.min(Math.max(n, 0), Find.Candidates); i++) {
      const item = await Finder.pin(n === 1 ? loc : loc.nth(i));
      if (!item) continue;
      const d = await Finder.describe(item);
      const act = await Finder.actionable({ loc: item, how: '' });
      if ('loc' in act && act.loc !== item) d.actionable = await Finder.describe(act.loc);
      out.push(d);
    }
    return out;
  }

  /** Role, name and a selector verified to match only this element. */
  static async describe(loc: Locator): Promise<Params> {
    const out: Params = { context: null };
    out.ref = await Refs.issue(loc);
    if (out.ref) loc = await Refs.loc(loc.page(), out.ref);
    try {
      const line = (await loc.ariaSnapshot({ depth: 1 })).split('\n')[0];
      const m = line.match(Find.Head);
      if (m) { out.role = m[1]; if (m[2]) out.name = JSON.parse(`"${m[2]}"`).slice(0, Find.Name); }
    } catch {}
    try {
      const e = await loc.evaluate(el => ({ tag: el.tagName.toLowerCase(), visible: !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === 'fixed', text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() }));
      out.tag = e.tag; out.visible = await loc.isVisible();
      if (!out.name && e.text) out.text = e.text.slice(0, Find.Name);
    } catch {}
    out.selector = await Finder.unique(loc, out);
    out.selectorUnique = !!out.selector;
    const context = loc.locator(Find.Context);
    if (await Finder.count(context) === 1) {
      out.context = await context.evaluate(el => ({ tag: el.tagName.toLowerCase(), name: el.getAttribute('aria-label') || undefined, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) }));
      out.context.ref = await Refs.issue(context);
    }
    return out;
  }

  private static async unique(loc: Locator, d: Params): Promise<string | undefined> {
    const page = loc.page();
    const options: string[] = [];
    try { options.push((await loc.normalize() as unknown as { _selector: string })._selector); } catch {}
    if (d.role && d.name) options.push(`internal:role=${d.role}[name=${Rewrite.q(d.name, true)}]`);
    const base = (loc as unknown as { _selector?: string })._selector;
    if (base) options.push(base);
    for (const s of options) {
      if (!s || await Finder.count(page.locator(s)) !== 1) continue;
      const handle = await loc.elementHandle();
      if (!handle) continue;
      try { if (await page.locator(s).evaluate((el, target) => el === target, handle)) return s; } finally { await handle.dispose(); }
    }
    return undefined;
  }
}
