import { getQuickJS, type QuickJSDeferredPromise } from 'quickjs-emscripten';
import type { Locator, Page } from 'playwright-core';
import { Action, Find, Method, PolicyKey, type Forward, type Params } from './protocol.js';
import { Refs } from './refs.js';

export class ExecuteSpec {
  static readonly Playwright = 'playwright';
  static readonly JavaScript = 'javascript';
  static readonly Code = 16_000;
  static readonly Result = 30_000;
  static readonly Timeout = 8_000;
  static readonly MaxTimeout = 15_000;
  static readonly TimeoutError = 'execute_timeout';
  static readonly ScriptError = 'execute_script_error';
  static readonly LargeResult = 'execute_result_too_large';
  static readonly Pending = 'execute_unawaited_operation';
  static readonly CpuLimit = 'execute_cpu_limit';

  static validate(p: Params): void {
    if (typeof p.sessionId !== 'string' || !p.sessionId || typeof p.pageId !== 'string' || !p.pageId ||
        !Number.isSafeInteger(p.seq) || p.seq < 1 ||
        (p.mode !== ExecuteSpec.Playwright && p.mode !== ExecuteSpec.JavaScript) ||
        typeof p.code !== 'string' || !p.code.trim() || p.code.length > ExecuteSpec.Code ||
        (p.timeoutMs !== undefined && (!Number.isSafeInteger(p.timeoutMs) || p.timeoutMs < 1 || p.timeoutMs > ExecuteSpec.MaxTimeout)))
      throw Error('invalid_params');
  }
}

type Check = (url: string, actions?: Action[]) => void;
type Step = [kind: string, value: string | number, name?: string | null];
type Request = [steps: Step[], method: string, value?: string];
type Work = { request: Request; promise: QuickJSDeferredPromise };

export class Execute {
  private static readonly Methods = {
    click: Action.Click, fill: Action.Fill, press: Action.Click, hover: Action.Click,
    check: Action.Click, uncheck: Action.Click, selectOption: Action.Fill,
    scrollIntoViewIfNeeded: Action.Click, waitFor: Action.Observe, isVisible: Action.Observe,
    count: Action.Observe, innerText: Action.Observe, inputValue: Action.Observe,
    getAttribute: Action.Observe,
  } as const;

  // Guest locators are immutable descriptions. Only JSON crosses to the broker.
  private static readonly Guest = `
    const request = __tetherRequest;
    delete globalThis.__tetherRequest;
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    const errors = new WeakMap();
    const invoke = async (steps, method, value) => {
      const result = parse(await request(stringify([steps, method, value])));
      if (result.error) {
        const error = new Error(result.error);
        errors.set(error, result.error);
        throw error;
      }
      return result.value;
    };
    const locators = (steps) => ({
      locator: (selector) => locators([...steps, ['selector', selector]]),
      getByRole: (role, options) => locators([...steps, ['role', role, options?.name]]),
      getByText: (text) => locators([...steps, ['text', text]]),
      getByLabel: (label) => locators([...steps, ['label', label]]),
      nth: (index) => locators([...steps, ['nth', index]]),
      ...Object.fromEntries(${JSON.stringify(Object.keys(Execute.Methods))}.map(
        (method) => [method, (value) => invoke(steps, method, value)]
      )),
    });
    const page = Object.freeze({
      locator: (selector) => locators([['selector', selector]]),
      getByRole: (role, options) => locators([['role', role, options?.name]]),
      getByText: (text) => locators([['text', text]]),
      getByLabel: (label) => locators([['label', label]]),
      url: () => invoke([], 'url'),
      title: () => invoke([], 'title'),
      goto: (url) => invoke([], 'goto', url),
      ariaSnapshot: () => invoke([], 'ariaSnapshot'),
    });
    const ref = (id) => locators([['ref', id]]);
  `;

  static async run(page: Page, forward: Forward, p: Params, check: Check): Promise<Params> {
    const timeout = p.timeoutMs ?? ExecuteSpec.Timeout;
    const deadline = Date.now() + timeout;
    const url = page.url();
    const origin = new URL(url).origin;
    const guard: Check = (current, actions) => {
      if (new URL(current).origin !== origin) throw Error(PolicyKey.Denied);
      check(current, actions);
    };
    const browserActions = [Action.Observe, Action.Click, Action.Fill, Action.Navigate];
    const actions = p.mode === ExecuteSpec.JavaScript ? browserActions : undefined;
    guard(url, actions);
    try {
      const value = p.mode === ExecuteSpec.JavaScript
        ? await Execute.javascript(forward, p, origin, deadline, () => guard(page.url(), actions))
        : await Execute.playwright(page, p.code, deadline, guard);
      guard(page.url(), [Action.Observe]);
      return { value, sideEffect: 'possible' };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return { sideEffect: 'possible', error: code === PolicyKey.Denied || code.startsWith('execute_') ? code : ExecuteSpec.ScriptError };
    }
  }

  private static remaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error(ExecuteSpec.TimeoutError);
    return remaining;
  }

  private static parse(data: unknown): unknown {
    if (typeof data !== 'string') throw Error(ExecuteSpec.ScriptError);
    if (data.length > ExecuteSpec.Result) throw Error(ExecuteSpec.LargeResult);
    return JSON.parse(data);
  }

  private static async javascript(forward: Forward, p: Params, origin: string, deadline: number, check: () => void): Promise<unknown> {
    const cdp = (method: string, params: Params = {}) => forward(Method.CDP, {
      clientId: p.clientId, sessionId: p.sessionId, pageId: p.pageId, expectedOrigin: origin, method, params,
    });
    const { frameTree } = await cdp('Page.getFrameTree');
    const { executionContextId } = await cdp('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'tether-execute' });
    check();
    const timeout = Execute.remaining(deadline);
    const body = JSON.stringify(p.code);
    const source = `(() => {
      if (location.origin !== ${JSON.stringify(origin)}) return { error: '${PolicyKey.Denied}' };
      const stringify = JSON.stringify;
      const work = Object.getPrototypeOf(async function () {}).constructor(${body});
      let timer;
      return Promise.race([
        work().then(value => {
          const json = stringify(value ?? null);
          return json.length > ${ExecuteSpec.Result} ? { error: '${ExecuteSpec.LargeResult}' } : { json };
        }).catch(() => ({ error: '${ExecuteSpec.ScriptError}' })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ error: '${ExecuteSpec.TimeoutError}' }), ${timeout}); }),
      ]).finally(() => clearTimeout(timer));
    })()`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        cdp('Runtime.evaluate', { expression: source, contextId: executionContextId, awaitPromise: true, returnByValue: true, timeout }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(ExecuteSpec.TimeoutError)), timeout); }),
      ]);
      Execute.remaining(deadline);
      if (response.result?.value?.error) throw Error(response.result.value.error);
      return Execute.parse(response.result?.value?.json);
    } finally {
      clearTimeout(timer);
    }
  }

  private static async playwright(page: Page, code: string, deadline: number, check: Check): Promise<unknown> {
    const quickjs = await getQuickJS();
    const runtime = quickjs.newRuntime({ memoryLimitBytes: 16 * 1024 * 1024, maxStackSizeBytes: 512 * 1024 });
    let interrupted = false;
    let slice = deadline;
    runtime.setInterruptHandler(() => {
      interrupted = Date.now() >= slice;
      return interrupted;
    });
    const checkBudget = () => {
      Execute.remaining(deadline);
      if (interrupted) throw Error(ExecuteSpec.CpuLimit);
    };
    const vm = runtime.newContext();
    const queue: Work[] = [];
    let calls = 0;
    try {
      using bridge = vm.newFunction('__tetherRequest', (input) => {
        const json = vm.getString(input);
        if (++calls > 100 || json.length > ExecuteSpec.Code) throw Error('execute_operation_limit');
        const promise = vm.newPromise();
        queue.push({ request: JSON.parse(json), promise });
        return promise.handle;
      });
      vm.setProp(vm.global, '__tetherRequest', bridge);
      slice = Math.min(deadline, Date.now() + 250);
      const start = vm.evalCode(`(async () => {
        ${Execute.Guest}
        try {
          const run = Object.getPrototypeOf(async function () {}).constructor('page', 'ref', ${JSON.stringify('"use strict";\n' + code)});
          const value = await run(page, ref);
          const json = stringify({ value: value ?? null });
          return json.length > ${ExecuteSpec.Result} ? '' : json;
        } catch (error) {
          return stringify({ error: errors.get(error) ?? '${ExecuteSpec.ScriptError}' });
        }
      })()`);
      if (start.error) {
        start.error.dispose();
        checkBudget();
        throw Error(ExecuteSpec.ScriptError);
      }
      using promise = start.value;
      for (;;) {
        checkBudget();
        slice = Math.min(deadline, Date.now() + 250);
        const jobs = runtime.executePendingJobs(100);
        if (jobs.error) {
          jobs.error.dispose();
          checkBudget();
          throw Error(ExecuteSpec.ScriptError);
        }
        checkBudget();
        const state = vm.getPromiseState(promise);
        if (state.type === 'fulfilled') {
          using result = state.value;
          if (queue.length) throw Error(ExecuteSpec.Pending);
          const value = vm.getString(result);
          if (!value) throw Error(ExecuteSpec.LargeResult);
          const reply = Execute.parse(value) as Params;
          if (reply.error) throw Error(reply.error);
          return reply.value;
        }
        if (state.type === 'rejected') {
          state.error.dispose();
          throw Error(ExecuteSpec.ScriptError);
        }
        if (jobs.value === 100) {
          await new Promise<void>(resolve => setImmediate(resolve));
          continue;
        }
        const next = queue.shift();
        if (!next) throw Error(ExecuteSpec.Pending);
        let reply: Params;
        try {
          const value = await Execute.operation(page, next.request, deadline, check);
          const json = JSON.stringify({ value });
          reply = json.length > ExecuteSpec.Result ? { error: ExecuteSpec.LargeResult } : { value };
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          reply = { error: code === PolicyKey.Denied || code.startsWith('execute_') ? code : 'execute_operation_failed' };
        }
        using deferred = next.promise;
        using output = vm.newString(JSON.stringify(reply));
        deferred.resolve(output);
      }
    } finally {
      for (const { promise } of queue) promise.dispose();
      vm.dispose();
      runtime.dispose();
    }
  }

  private static async operation(page: Page, [steps, method, value]: Request, deadline: number, check: Check): Promise<unknown> {
    const timeout = Execute.remaining(deadline);
    if (!steps.length) {
      check(page.url(), [method === 'goto' ? Action.Navigate : Action.Observe]);
      switch (method) {
        case 'url': return page.url();
        case 'title': return page.title();
        case 'ariaSnapshot': return page.ariaSnapshot({ timeout });
        case 'goto': {
          const url = new URL(value!, page.url()).href;
          check(url, [Action.Navigate]);
          await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
          check(page.url(), [Action.Navigate]);
          return;
        }
        default: throw Error('execute_invalid_operation');
      }
    }
    if (!Object.hasOwn(Execute.Methods, method) || steps.length > 12)
      throw Error('execute_invalid_operation');
    const action = Execute.Methods[method as keyof typeof Execute.Methods];
    check(page.url(), method === 'press' ? [Action.Click, Action.Fill] : [action]);
    let locator: Locator | undefined;
    for (const [kind, text, name] of steps) {
      const root: Page | Locator = locator ?? page;
      switch (kind) {
        case 'selector':
          if (typeof text !== 'string') throw Error('execute_invalid_operation');
          locator = root.locator(text);
          break;
        case 'role':
          if (typeof text !== 'string' || (name !== undefined && name !== null && typeof name !== 'string')) throw Error('execute_invalid_operation');
          locator = root.getByRole(text as Parameters<Page['getByRole']>[0], { name: name ?? undefined, exact: true });
          break;
        case 'label': locator = root.getByLabel(String(text), { exact: true }); break;
        case 'text': locator = root.getByText(String(text), { exact: true }); break;
        case 'nth':
          if (!locator || !Number.isSafeInteger(text)) throw Error('execute_invalid_operation');
          locator = locator.nth(Number(text));
          break;
        case 'ref':
          if (locator || typeof text !== 'string' || !Find.Ref.test(text)) throw Error('execute_invalid_operation');
          locator = await Refs.loc(page, text);
          break;
        default: throw Error('execute_invalid_operation');
      }
    }
    if (!locator) throw Error('execute_invalid_operation');
    check(page.url(), [action]);
    const opts = { timeout: Execute.remaining(deadline) };
    switch (method) {
      case 'click': return locator.click(opts);
      case 'fill': return locator.fill(String(value), opts);
      case 'press': return locator.press(String(value), opts);
      case 'hover': return locator.hover(opts);
      case 'check': return locator.check(opts);
      case 'uncheck': return locator.uncheck(opts);
      case 'selectOption': return locator.selectOption(String(value), opts);
      case 'scrollIntoViewIfNeeded': return locator.scrollIntoViewIfNeeded(opts);
      case 'waitFor': return locator.waitFor(opts);
      case 'isVisible': return locator.isVisible();
      case 'count': return locator.count();
      case 'innerText': return locator.innerText(opts);
      case 'inputValue': return locator.inputValue(opts);
      case 'getAttribute': return locator.getAttribute(String(value), opts);
    }
  }
}
