import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Server } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StreamableHTTPServerTransport } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '../prototype/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { chromium } from '../prototype/node_modules/playwright-core/index.mjs';
import { BridgeClient, loadConfig } from '../prototype/dist/client.js';
import { SandboxBootstrap } from './bootstrap.mjs';
import { Paths, Wire } from './constants.mjs';

class Sandbox {
  context = null;
  chrome = null;
  connection = null;
  extensions = [];
  client = null;
  busy = Promise.resolve();

  async init() {
    await SandboxBootstrap.run();
    // This volume belongs to one container; its previous PID namespace is gone.
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      await rm(`${Paths.Profile}/${name}`, { force: true });
    }
    this.extensionId = SandboxBootstrap.extId();
    if (!existsSync(Paths.Token)) await writeFile(Paths.Token, randomBytes(32).toString('hex'), { mode: 0o600 });
    this.token = (await readFile(Paths.Token, 'utf8')).trim();
    this.client = new BridgeClient(await loadConfig(Paths.Client));
  }

  async status() {
    let broker;
    try { broker = await this.client.capabilities(); }
    catch (error) { broker = { browserConnected: false, error: error.message }; }
    return { browser: this.context ? 'running' : 'stopped', extensionId: this.extensionId, broker,
      profile: Paths.Profile, pages: this.context?.pages().map(page => page.url()) ?? [] };
  }

  async browser(op, extensions) {
    if (!['start', 'stop', 'restart', 'reset'].includes(op)) throw Error('invalid_browser_operation');
    if (extensions !== undefined) {
      if (!Array.isArray(extensions) || extensions.some(path => typeof path !== 'string' || path.includes(',') || !existsSync(`${path}/manifest.json`))) throw Error('extension_manifest_missing');
      this.extensions = extensions;
    }
    if (op !== 'start' && this.context) {
      this.context = null;
      this.client.close();
      await this.connection?.close();
      this.connection = null;
      if (this.chrome?.exitCode === null) {
        const stopped = new Promise(resolve => this.chrome.once('exit', resolve));
        this.chrome.kill('SIGTERM');
        await stopped;
      }
    }
    if (op === 'reset') await rm(Paths.Profile, { recursive: true, force: true });
    if (op !== 'stop' && !this.context) {
      this.chrome = spawn(chromium.executablePath(), [
        `--user-data-dir=${Paths.Profile}`, `--disable-extensions-except=${[Paths.Extension, ...this.extensions].join(',')}`, `--load-extension=${[Paths.Extension, ...this.extensions].join(',')}`,
        '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9222',
        '--remote-debugging-address=127.0.0.1', '--enable-logging', '--log-file=/data/chrome.log', 'about:blank',
      ], { stdio: 'ignore' });
      this.chrome.on('error', error => console.error(error.message));
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        if (!this.connection) {
          let listening = false;
          try { listening = (await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch {}
          if (listening) {
            this.connection = await chromium.connectOverCDP('http://127.0.0.1:9222');
            this.context = this.connection.contexts()[0];
            // Inspection leaves dialogs for the authorized Tether session to answer.
            this.context.on('dialog', () => {});
            this.context.setDefaultTimeout(10000);
            await this.refresh();
          }
        }
        let ready = false;
        try { ready = (await this.client.capabilities()).browserConnected; } catch {}
        if (ready && this.context) return this.status();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw Error('native_bridge_start_timeout');
    }
    return this.status();
  }

  async refresh() {
    const hash = createHash('sha256');
    const files = (await readdir(Paths.Extension)).filter(name => name.endsWith('.js') || name === 'manifest.json').sort();
    for (const name of files) hash.update(name).update(await readFile(`${Paths.Extension}/${name}`));
    const build = hash.digest('hex');
    let previous;
    try { previous = await readFile(Paths.ExtensionStamp, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // The WebUI survives extension reload and waits for Chrome to finish it.
    const manager = await this.context.newPage();
    try {
      await manager.goto('chrome://extensions');
      await manager.evaluate(async ({ id, changed }) => {
        const chrome = globalThis.chrome;
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        if (changed) await chrome.developerPrivate.reload(id, { failQuietly: true });
        const info = await chrome.management.get(id);
        if (!info.enabled) await chrome.management.setEnabled(id, true);
      }, { id: this.extensionId, changed: previous !== build });
    } finally { await manager.close(); }
    await writeFile(Paths.ExtensionStamp, build);
  }

  async exec({ command, timeoutMs = Wire.Timeout }) {
    if (typeof command !== 'string' || !command.trim()) throw Error('command_required');
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', ['-lc', command], { cwd: Paths.Data, detached: true });
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; process.kill(-child.pid, 'SIGKILL'); }, Math.min(Math.max(timeoutMs, 100), 300000));
      child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-100000); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-100000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    });
  }

  async files({ op, path, content }) {
    if (typeof path !== 'string') throw Error('path_required');
    if (op === 'read') return { content: await readFile(path, 'utf8') };
    if (op === 'list') return { entries: await readdir(path, { withFileTypes: true }).then(items => items.map(item => ({ name: item.name, directory: item.isDirectory() }))) };
    if (op === 'write') {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
      return { written: path };
    }
    throw Error('invalid_file_operation');
  }

  async call(name, args) {
    if (name === Wire.Status) return this.status();
    if (name === Wire.Browser) return this.browser(args.op, args.extensions);
    if (name === Wire.Exec) return this.exec(args);
    if (name === Wire.Files) return this.files(args);
    if (name === Wire.Tether) return this.client.call(args.method, args.params ?? {});
    if (name === Wire.Cdp) {
      if (!this.connection) throw Error('browser_stopped');
      const session = await this.connection.newBrowserCDPSession();
      try {
        if (!args.targetId) return await session.send(args.method, args.params ?? {});
        const attached = await session.send('Target.attachToTarget', { targetId: args.targetId, flatten: false });
        const result = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('cdp_timeout')), 15000);
          session.on('Target.receivedMessageFromTarget', event => {
            const message = JSON.parse(event.message);
            if (event.sessionId !== attached.sessionId || message.id !== 1) return;
            clearTimeout(timer);
            if (message.error) reject(Error(message.error.message)); else resolve(message.result);
          });
        });
        await session.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id: 1, method: args.method, params: args.params ?? {} }) });
        return await result;
      } finally { await session.detach(); }
    }
    if (name === Wire.Eval) {
      if (!this.context) throw Error('browser_stopped');
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      return (await new AsyncFunction('context', 'browser', 'chromium', args.code)(this.context, this.context.browser(), chromium)) ?? null;
    }
    throw Error('unknown_tool');
  }

  static schema(properties = {}, required = []) { return { type: 'object', properties, required, additionalProperties: false }; }
  static tools() {
    const str = { type: 'string' };
    return [
      { name: Wire.Status, description: 'Inspect the isolated Messenger browser, extension ID and real Native Messaging bridge.', inputSchema: this.schema() },
      { name: Wire.Browser, description: 'Start, stop, restart or reset the dedicated test browser. Reset deletes only its test profile. Optional extensions lists extra unpacked extension directories inside the sandbox (Tether stays loaded). Pass [] to clear extra extensions. No human approval needed inside this sandbox.', inputSchema: this.schema({ op: { enum: ['start', 'stop', 'restart', 'reset'] }, extensions: { type: 'array', items: str } }, ['op']) },
      { name: Wire.Exec, description: 'Run bash freely INSIDE the dedicated Docker test sandbox, with Node/Python and test source. No host filesystem or Docker socket is mounted. Output tail 100000 characters; save larger artifacts under /data.', inputSchema: this.schema({ command: str, timeoutMs: { type: 'integer', minimum: 100, maximum: 300000 } }, ['command']) },
      { name: Wire.Files, description: 'Read, write or list files inside the sandbox. /data persists across container restarts.', inputSchema: this.schema({ op: { enum: ['read', 'write', 'list'] }, path: str, content: str }, ['op', 'path']) },
      { name: Wire.Eval, description: 'Execute an async JavaScript function body with Playwright context, browser and chromium. Use return for JSON results. Can operate pages, extension popup/service workers, uploads/downloads/dialogs, screenshots and raw CDP without human intervention. Screenshot via page.screenshot then return base64 or save /data. Browser is dedicated to tests.', inputSchema: this.schema({ code: str }, ['code']) },
      { name: Wire.Screenshot, description: 'Return a browser screenshot as an MCP image. pageIndex comes from sandbox_status pages; defaults to the last page.', inputSchema: this.schema({ pageIndex: { type: 'integer', minimum: 0 }, fullPage: { type: 'boolean' } }) },
      { name: Wire.Cdp, description: 'Run any Chrome DevTools Protocol command. Without targetId it addresses the browser (e.g. Target.getTargets). Supply targetId to control a real toolbar popup, service worker, iframe or page, including targets outside Playwright pages().', inputSchema: this.schema({ targetId: str, method: str, params: { type: 'object', additionalProperties: true } }, ['method']) },
      { name: Wire.Tether, description: 'Call the real Tether Broker through Native Messaging and the installed extension. Methods: requestSession, approvalStatus, availableTabs, listTabs, createTab, closeTab, release, capabilities, html, snapshot, locate, fill, click, navigate, network. Start with requestSession {mode:newGroup,url}; use sessionId/pageId; monotonically increase seq for mutations. network op=start/list/detail/body/stop/clear.', inputSchema: this.schema({ method: str, params: { type: 'object', additionalProperties: true } }, ['method']) },
    ];
  }

  async serve(req, res) {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/meta')) {
      res.setHeader('X-BNP-Version', 'v1');
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/meta') return res.end(JSON.stringify({ version: Wire.Version, owner: 'Tether', extra: { isolation: 'docker' } }));
      // Stopping the browser is an intentional supported workflow; MCP availability is service health.
      return res.end(JSON.stringify({ status: 'ok', checks: [{ name: 'mcp', status: 'ok' }], browser: this.context ? 'running' : 'stopped' }));
    }
    const given = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (req.url !== '/mcp' || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(401); return res.end('unauthorized');
    }
    const server = new Server({ name: 'messenger-browser-sandbox', version: Wire.Version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Sandbox.tools() }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      try {
        if (request.params.name === Wire.Screenshot) {
          const args = request.params.arguments ?? {};
          const pages = this.context?.pages() ?? [];
          const page = pages[args.pageIndex ?? pages.length - 1];
          if (!page) throw Error('page_missing');
          const data = await page.screenshot({ type: 'png', fullPage: args.fullPage ?? false });
          return { content: [{ type: 'image', mimeType: 'image/png', data: data.toString('base64') }] };
        }
        const run = request.params.name === Wire.Browser
          ? this.busy.then(() => this.call(request.params.name, request.params.arguments ?? {}))
          : this.call(request.params.name, request.params.arguments ?? {});
        if (request.params.name === Wire.Browser) this.busy = run.catch(() => {});
        return { content: [{ type: 'text', text: JSON.stringify(await run) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error.stack ?? error.message }] }; }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  static async main() {
    const sandbox = new Sandbox();
    await sandbox.init();
    createServer((req, res) => sandbox.serve(req, res).catch(error => {
      console.error(error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    })).listen(Wire.Port, '0.0.0.0', () => console.log('sandbox_ready'));
    sandbox.busy = sandbox.browser('start').catch(error => console.error(error.message));
    process.on('SIGTERM', async () => { await sandbox.browser('stop'); process.exit(0); });
  }
}

Sandbox.main().catch(error => { console.error(error); process.exit(1); });
