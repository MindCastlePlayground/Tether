import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeClient, loadConfig } from "./client.js";
import { Rpc } from "./client-constants.js";
import { Config } from "./config.js";
import { Brand, Method, Wake } from "./protocol.js";
import { Autostart } from "./autostart.js";
import { I18n, McpHint, McpText } from "./i18n.js";
import { BrowserWake } from "./wake.js";

class McpTools {
  static readonly EMPTY = z.object({});
  static readonly SESSION = z.object({ mode: z.enum(["newGroup", "attachExisting"]), url: z.string().optional(), tabId: z.number().int().nonnegative().optional() });
  static readonly APPROVAL = z.object({ pendingId: z.string() });
  static readonly TABS = z.object({ sessionId: z.string() });
  static readonly RELEASE = z.object({ sessionId: z.string(), seq: z.number().int().positive() });
  static readonly CREATE = z.object({ sessionId: z.string(), seq: z.number().int().positive(), url: z.string().optional() });
  static readonly PAGE = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive() });
  static readonly OBSERVE = z.object({ sessionId: z.string(), pageId: z.string() });
  static readonly TARGET = (o: { selector?: string; ref?: string }) => (o.selector === undefined) !== (o.ref === undefined);
  static readonly OBSERVATION = z.object({ scope: z.string().optional(), scopeRef: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), maxChars: z.number().int().positive().optional() }).strict().refine(o => !(o.scope !== undefined && o.scopeRef !== undefined), { message: "scopeOrScopeRef" });
  static readonly FILL = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), selector: z.string().optional(), ref: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), value: z.string(), observe: McpTools.OBSERVATION.optional() }).refine(McpTools.TARGET, { message: "selectorOrRef" });
  static readonly CLICK = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), selector: z.string().optional(), ref: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), observe: McpTools.OBSERVATION.optional() }).refine(McpTools.TARGET, { message: "selectorOrRef" });
  static readonly SNAPSHOT = z.object({ sessionId: z.string(), pageId: z.string(), scope: z.string().optional(), scopeRef: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), outline: z.boolean().optional(), depth: z.number().int().positive().optional(), maxChars: z.number().int().positive().optional() }).refine(o => !(o.scope !== undefined && o.scopeRef !== undefined), { message: "scopeOrScopeRef" });
  static readonly LOCATE = z.object({ sessionId: z.string(), pageId: z.string(), text: z.string().optional(), role: z.string().optional(), name: z.string().optional(), exact: z.boolean().optional(), selector: z.string().optional(), ref: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), scope: z.string().optional(), scopeRef: z.string().regex(/^[a-z0-9]{1,64}$/).optional() }).refine(o => !(o.scope !== undefined && o.scopeRef !== undefined), { message: "scopeOrScopeRef" });
  static readonly NAVIGATE = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), url: z.string() });
  static readonly SCHEMAS = [
    { type: "object", properties: { mode: { type: "string", enum: ["newGroup", "attachExisting"] }, url: { type: "string" }, tabId: { type: "integer", minimum: 0 } }, required: ["mode"], additionalProperties: false },
    { type: "object", properties: { pendingId: { type: "string" } }, required: ["pendingId"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, seq: { type: "integer", minimum: 1 }, url: { type: "string" } }, required: ["sessionId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 } }, required: ["sessionId", "pageId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, seq: { type: "integer", minimum: 1 } }, required: ["sessionId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" } }, required: ["sessionId", "pageId"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 }, selector: { type: "string" }, ref: { type: "string", pattern: "^[a-z0-9]{1,64}$", description: "Opaque ref from a fresh snapshot, e.g. tabc123e12" }, value: { type: "string" }, observe: { type: "object", properties: { scope: { type: "string" }, scopeRef: { type: "string", pattern: "^[a-z0-9]{1,64}$" }, maxChars: { type: "integer", minimum: 1 } }, additionalProperties: false, not: { required: ["scope", "scopeRef"] } } }, required: ["sessionId", "pageId", "seq", "value"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 }, selector: { type: "string" }, ref: { type: "string", pattern: "^[a-z0-9]{1,64}$", description: "Opaque ref from a fresh snapshot, e.g. tabc123e12" }, observe: { type: "object", properties: { scope: { type: "string" }, scopeRef: { type: "string", pattern: "^[a-z0-9]{1,64}$" }, maxChars: { type: "integer", minimum: 1 } }, additionalProperties: false, not: { required: ["scope", "scopeRef"] } } }, required: ["sessionId", "pageId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 }, url: { type: "string" } }, required: ["sessionId", "pageId", "seq", "url"], additionalProperties: false },
    { type: "object", properties: {}, additionalProperties: false },
    { type: "object", properties: {}, additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, scope: { type: "string" }, scopeRef: { type: "string", pattern: "^[a-z0-9]{1,64}$", description: "Opaque ref from a fresh snapshot" }, outline: { type: "boolean" }, depth: { type: "integer", minimum: 1 }, maxChars: { type: "integer", minimum: 1 } }, required: ["sessionId", "pageId"], additionalProperties: false, not: { required: ["scope", "scopeRef"] } },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, text: { type: "string" }, role: { type: "string" }, name: { type: "string" }, exact: { type: "boolean" }, selector: { type: "string" }, ref: { type: "string", pattern: "^[a-z0-9]{1,64}$" }, scope: { type: "string" }, scopeRef: { type: "string", pattern: "^[a-z0-9]{1,64}$" } }, required: ["sessionId", "pageId"], additionalProperties: false, not: { required: ["scope", "scopeRef"] } },
  ];
}

async function main(): Promise<void> {
  await Autostart.run().catch(() => {});
  const path = process.env.BB_CLIENT_CONFIG;
  if (!path) throw new Error("missingConfigPath");
  const client = new BridgeClient(await loadConfig(path));
  const wake = new BrowserWake(client);
  const folder = Config.extension(path);
  const server = new Server({ name: Brand.Name, version: Brand.Version }, { capabilities: { tools: {} } });
  const descriptions = McpText.TOOLS[I18n.language()];
  const tools = [
    ["requestSession", descriptions.requestSession, McpTools.SESSION],
    ["approvalStatus", descriptions.approvalStatus, McpTools.APPROVAL],
    ["listTabs", descriptions.listTabs, McpTools.TABS],
    ["createTab", descriptions.createTab, McpTools.CREATE],
    ["closeTab", descriptions.closeTab, McpTools.PAGE],
    ["release", descriptions.release, McpTools.RELEASE],
    ["observe", descriptions.observe, McpTools.OBSERVE],
    ["fill", descriptions.fill, McpTools.FILL],
    ["click", descriptions.click, McpTools.CLICK],
    ["navigate", descriptions.navigate, McpTools.NAVIGATE],
    ["capabilities", descriptions.capabilities, McpTools.EMPTY],
    ["availableTabs", descriptions.availableTabs, McpTools.EMPTY],
    ["snapshot", descriptions.snapshot, McpTools.SNAPSHOT],
    ["locate", descriptions.locate, McpTools.LOCATE],
  ] as const;
  server.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).ListToolsRequestSchema, async () => ({ tools: tools.map(([name, description], i) => ({ name, description, inputSchema: McpTools.SCHEMAS[i] })) }));
  server.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params;
    if (!(Rpc.METHODS as readonly string[]).includes(name)) throw new Error("unsupportedMethod");
    const item = tools.find(t => t[0] === name);
    if (!item) throw new Error("unsupportedMethod");
    const parsed = item[2].parse(args) as Record<string, unknown>;
    const run = async () => {
      if (name !== Method.Capabilities) await wake.ready();
      return client.call(name as typeof Rpc.METHODS[number], parsed);
    };
    let result;
    try {
      try { result = await run(); }
      catch (e) {
        // Recover the Broker/browser link, then retry what is known to be safe.
        const code = (e as Error).message;
        if (!Wake.Unsent.has(code) && !Wake.Lost.has(code)) throw e;
        wake.lost();
        if (!Wake.Unsent.has(code) && !Wake.Reads.has(name)) throw e;
        result = await run();
      }
    } catch (e) {
      if ((e as Error).message === Wake.Missing) throw new Error(McpHint.BROWSER[I18n.language()].replace("$1", () => folder));
      throw e;
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => client.close());
}

main().catch(() => { process.stderr.write("browserBridgeMcpFailed\n"); process.exitCode = 1; });
