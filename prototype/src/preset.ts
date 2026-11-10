import { randomUUID } from 'node:crypto';
import type { Params } from './protocol.js';

/** Operation trace and saved presets. Filled values stay as given, including passwords. */
export class Trace {
  static readonly Limit = 100;
  static readonly Value = 16_000;
  static readonly Ops = ['list', 'export', 'clear'];
  static readonly Methods = new Set(['navigate', 'click', 'fill', 'wait', 'assert']);
  private rows = new Map<string, Params[]>();

  note(client: string, method: string, params: Params, result?: Params, thrown?: string): void {
    if (!Trace.Methods.has(method)) return;
    const error = Trace.code(thrown ?? result?.error);
    const entry: Params = {
      at: new Date().toISOString(), method,
      status: error || result?.passed === false ? 'failed' : 'ok',
    };
    if (result?.sideEffect) entry.sideEffect = result.sideEffect;
    if (error) entry.error = error;
    for (const key of ['sessionId', 'pageId', 'seq', 'selector', 'ref'] as const) if (params[key] !== undefined) entry[key] = params[key];
    if (method === 'navigate' && typeof params.url === 'string') entry.url = params.url.slice(0, 2000);
    if (method === 'fill' && typeof params.value === 'string') {
      entry.value = params.value.slice(0, Trace.Value);
      if (params.value.length > Trace.Value) entry.valueTruncated = true;
    }
    if (typeof result?.target?.selector === 'string') entry.resolved = result.target.selector;
    if (typeof result?.strategy === 'string') entry.strategy = result.strategy;
    if (method === 'wait' || method === 'assert') {
      entry.condition = params.condition;
      entry.expect = params.value;
      if (result?.passed !== undefined) entry.passed = result.passed;
    }
    const rows = this.rows.get(client) ?? [];
    rows.push(entry);
    this.rows.set(client, rows.slice(-Trace.Limit));
  }

  read(client: string, p: Params): Params {
    const op = p.op ?? 'list';
    if (!Trace.Ops.includes(op)) throw Error('invalid_params');
    if (op === 'clear') { this.rows.delete(client); return { cleared: true }; }
    const rows = this.rows.get(client) ?? [];
    if (op === 'export') {
      const text = JSON.stringify({ schemaVersion: 1, entries: rows });
      if (text.length > 400_000) throw Error('payload_too_large');
      return { filename: 'tether-trace.json', mimeType: 'application/json', text, total: rows.length };
    }
    const offset = Presets.integer(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = Presets.integer(p.limit, 50, 1, Trace.Limit);
    return { entries: rows.slice(offset, offset + limit), total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null };
  }

  static code(raw: unknown): string | undefined {
    if (raw === undefined) return undefined;
    return typeof raw === 'string' && /^[a-zA-Z_]{1,80}$/.test(raw) ? raw : 'request_failed';
  }
}

export class Presets {
  static readonly Ops = ['save', 'get', 'list', 'delete', 'export', 'run'];
  static readonly Kinds = ['navigate', 'click', 'fill', 'check'];
  static readonly Checks = ['text', 'url', 'visible', 'hidden', 'request'];
  static readonly Limit = 50;
  static readonly Steps = 40;
  private rows = new Map<string, Map<string, Params>>();

  execute(client: string, p: Params, invoke: (method: string, params: Params) => Promise<Params>): Promise<Params> | Params {
    if (!Presets.Ops.includes(p.op)) throw Error('invalid_params');
    if (p.op === 'list') return { presets: [...(this.rows.get(client)?.values() ?? [])].map(Presets.summary) };
    if (p.op === 'save') return this.save(client, p);
    const preset = this.one(client, p.id);
    if (p.op === 'get') return structuredClone(preset);
    if (p.op === 'delete') { this.rows.get(client)!.delete(preset.id); return { id: preset.id, deleted: true }; }
    if (p.op === 'export') return { id: preset.id, revision: preset.revision, filename: `preset-${preset.id}.mjs`, mimeType: 'text/javascript', text: Playwright.emit(preset.steps) };
    return this.run(preset, p, invoke);
  }

  private save(client: string, p: Params): Params {
    const steps = Presets.steps(p.steps);
    const store = this.rows.get(client) ?? new Map<string, Params>();
    const id = typeof p.id === 'string' ? p.id : Presets.fresh(store);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error('invalid_params');
    if (!store.has(id) && store.size >= Presets.Limit) throw Error('preset_limit');
    const title = p.title === undefined ? undefined : Presets.title(p.title);
    const preset: Params = { id, revision: (store.get(id)?.revision ?? 0) + 1, steps, at: new Date().toISOString() };
    if (title) preset.title = title;
    store.set(id, preset);
    this.rows.set(client, store);
    return structuredClone(preset);
  }

  private async run(preset: Params, p: Params, invoke: (method: string, params: Params) => Promise<Params>): Promise<Params> {
    if (typeof p.sessionId !== 'string' || !p.sessionId || typeof p.pageId !== 'string' || !p.pageId || !Number.isSafeInteger(p.seq) || p.seq <= 0) throw Error('invalid_params');
    let seq = p.seq as number;
    const results: Params[] = [];
    const stop = (stopped: boolean) => ({ id: preset.id, revision: preset.revision, stopped, results, nextSeq: seq });
    for (let index = 0; index < preset.steps.length; index++) {
      const step = preset.steps[index];
      const base = { sessionId: p.sessionId, pageId: p.pageId };
      if (step.kind === 'check') {
        const params: Params = { ...base, condition: step.condition, value: step.condition === 'visible' || step.condition === 'hidden' ? step.selector : step.expect };
        if (step.timeoutMs !== undefined) params.timeoutMs = step.timeoutMs;
        const result = await Presets.call(invoke, 'assert', params, results, index);
        if (!result || result.passed !== true) return stop(true);
        continue;
      }
      if (step.kind === 'navigate') {
        const acted = await Presets.call(invoke, 'navigate', { ...base, seq, url: step.url }, results, index);
        seq++;
        if (Presets.blocked(acted)) return stop(true);
        continue;
      }
      let target: Params = { selector: step.selector };
      if (!step.selector) {
        const located = await Presets.call(invoke, 'locate', { ...base, role: step.role, name: step.name, exact: true }, results, index);
        const ref = located?.count === 1 ? located.candidates?.[0]?.ref : undefined;
        if (!located || located.error || !ref) return stop(true);
        target = { ref };
      }
      const acted = await Presets.call(invoke, step.kind, { ...base, seq, ...target, ...(step.kind === 'fill' ? { value: step.value } : {}) }, results, index);
      seq++;
      if (Presets.blocked(acted)) return stop(true);
    }
    return stop(false);
  }

  private one(client: string, id: unknown): Params {
    if (typeof id !== 'string' || !id) throw Error('invalid_params');
    const preset = this.rows.get(client)?.get(id);
    if (!preset) throw Error('preset_not_found');
    return preset;
  }

  private static blocked(result: Params | undefined): boolean {
    return !result || !!result.error || result.sideEffect === 'possible' || result.sideEffect === 'none';
  }

  private static async call(invoke: (method: string, params: Params) => Promise<Params>, method: string, params: Params, results: Params[], index: number): Promise<Params | undefined> {
    try {
      const result = await invoke(method, params);
      results.push({ index, method, ...(params.seq ? { seq: params.seq } : {}), result });
      return result;
    } catch (error) {
      results.push({ index, method, ...(params.seq ? { seq: params.seq } : {}), error: Trace.code((error as Error).message) });
      return undefined;
    }
  }

  private static summary(preset: Params): Params {
    return { id: preset.id, title: preset.title, revision: preset.revision, steps: preset.steps.length, at: preset.at };
  }

  private static fresh(store: Map<string, Params>): string {
    let id: string;
    do id = randomUUID().replace(/-/g, '').slice(0, 12); while (store.has(id));
    return id;
  }

  private static title(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw Error('invalid_params');
    return value.trim();
  }

  static integer(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw Error('invalid_params');
    return value as number;
  }

  private static steps(value: unknown): Params[] {
    if (!Array.isArray(value) || !value.length || value.length > Presets.Steps) throw Error('invalid_params');
    return value.map(step => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw Error('invalid_params');
      const keys = Object.keys(step);
      if (!keys.length || keys.some(key => !['kind', 'url', 'selector', 'role', 'name', 'value', 'condition', 'expect', 'timeoutMs'].includes(key))) throw Error('invalid_params');
      if (!Presets.Kinds.includes(step.kind)) throw Error('invalid_params');
      const selector = Presets.text(step.selector, 2000);
      const role = Presets.text(step.role, 64);
      const name = Presets.text(step.name, 200);
      const located = selector !== undefined || (role !== undefined && name !== undefined);
      if (step.kind === 'navigate') {
        if (typeof step.url !== 'string' || !/^https?:\/\//i.test(step.url) || step.url.length > 2000) throw Error('invalid_params');
        return { kind: 'navigate', url: step.url };
      }
      if (step.kind === 'check') {
        if (!Presets.Checks.includes(step.condition) || typeof step.expect !== 'string' || !step.expect || step.expect.length > 2000) throw Error('invalid_params');
        if ((step.condition === 'visible' || step.condition === 'hidden') && selector === undefined) throw Error('invalid_params');
        const out: Params = { kind: 'check', condition: step.condition, expect: step.expect };
        if (selector !== undefined) out.selector = step.selector;
        if (step.timeoutMs !== undefined) out.timeoutMs = Presets.integer(step.timeoutMs, 0, 0, 15000);
        return out;
      }
      if (!located) throw Error('invalid_params');
      const out: Params = { kind: step.kind };
      if (selector !== undefined) out.selector = step.selector;
      if (role !== undefined) out.role = step.role;
      if (name !== undefined) out.name = step.name;
      if (step.kind === 'fill') {
        if (typeof step.value !== 'string' || step.value.length > Trace.Value) throw Error('invalid_params');
        out.value = step.value;
      }
      return out;
    });
  }

  private static text(value: unknown, max: number): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value || value.length > max) throw Error('invalid_params');
    return value;
  }
}

export class Playwright {
  static emit(steps: Params[]): string {
    const lines = [
      "import { chromium } from 'playwright';",
      'const browser = await chromium.launch({ headless: true });',
      'const page = await browser.newPage();',
      'page.setDefaultTimeout(15000);',
      'try {',
    ];
    for (const step of steps) lines.push(Playwright.step(step));
    lines.push('} finally {', '  await browser.close();', '}', '');
    return lines.join('\n');
  }

  private static step(step: Params): string {
    if (step.kind === 'navigate') return `  await page.goto(${JSON.stringify(step.url)});`;
    if (step.kind === 'check') return Playwright.check(step);
    const target = Playwright.target(step);
    if (step.kind === 'fill') return `  await ${target}.fill(${JSON.stringify(step.value)});`;
    return `  await ${target}.click();`;
  }

  private static check(step: Params): string {
    const timeout = step.timeoutMs ?? 5000;
    if (step.condition === 'url') return `  if (page.url() !== ${JSON.stringify(step.expect)}) throw new Error('check_failed');`;
    if (step.condition === 'text') return `  if (!(await page.locator('body').innerText()).includes(${JSON.stringify(step.expect)})) throw new Error('check_failed');`;
    if (step.condition === 'request') return `  await page.waitForResponse(response => response.url().includes(${JSON.stringify(step.expect)}) && response.status() < 400, { timeout: ${Math.max(timeout, 1)} });`;
    const state = step.condition === 'hidden' ? 'hidden' : 'visible';
    if (!timeout) return `  if (await ${Playwright.target(step)}.isVisible() !== ${step.condition === 'visible'}) throw new Error('check_failed');`;
    return `  await ${Playwright.target(step)}.waitFor({ state: '${state}', timeout: ${timeout} });`;
  }

  private static target(step: Params): string {
    if (typeof step.selector === 'string') return `page.locator(${JSON.stringify(step.selector)})`;
    return `page.getByRole(${JSON.stringify(step.role)}, { name: ${JSON.stringify(step.name)}, exact: true })`;
  }
}
