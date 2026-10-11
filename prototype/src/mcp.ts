import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeClient, loadConfig } from "./client.js";
import { Rpc } from "./client-constants.js";
import { Brand } from "./protocol.js";

class McpTools {
  static readonly EMPTY = z.object({});
  static readonly SESSION = z.object({ mode: z.enum(["newGroup", "attachExisting"]), url: z.string().optional(), tabId: z.number().int().nonnegative().optional() });
  static readonly APPROVAL = z.object({ pendingId: z.string() });
  static readonly TABS = z.object({ sessionId: z.string() });
  static readonly RELEASE = z.object({ sessionId: z.string(), seq: z.number().int().positive() });
  static readonly CREATE = z.object({ sessionId: z.string(), seq: z.number().int().positive(), url: z.string().optional() });
  static readonly PAGE = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive() });
  static readonly OBSERVE = z.object({ sessionId: z.string(), pageId: z.string() });
  static readonly FILL = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), selector: z.string(), value: z.string() });
  static readonly CLICK = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), selector: z.string() });
  static readonly NAVIGATE = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), url: z.string() });
  static readonly SCHEMAS = [
    { type: "object", properties: { mode: { type: "string", enum: ["newGroup", "attachExisting"] }, url: { type: "string" }, tabId: { type: "integer", minimum: 0 } }, required: ["mode"], additionalProperties: false },
    { type: "object", properties: { pendingId: { type: "string" } }, required: ["pendingId"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, seq: { type: "integer", minimum: 1 }, url: { type: "string" } }, required: ["sessionId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 } }, required: ["sessionId", "pageId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, seq: { type: "integer", minimum: 1 } }, required: ["sessionId", "seq"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" } }, required: ["sessionId", "pageId"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 }, selector: { type: "string" }, value: { type: "string" } }, required: ["sessionId", "pageId", "seq", "selector", "value"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 }, selector: { type: "string" } }, required: ["sessionId", "pageId", "seq", "selector"], additionalProperties: false },
    { type: "object", properties: { sessionId: { type: "string" }, pageId: { type: "string" }, seq: { type: "integer", minimum: 1 }, url: { type: "string" } }, required: ["sessionId", "pageId", "seq", "url"], additionalProperties: false },
    { type: "object", properties: {}, additionalProperties: false },
    { type: "object", properties: {}, additionalProperties: false },
  ];
}

async function main(): Promise<void> {
  const path = process.env.BB_CLIENT_CONFIG;
  if (!path) throw new Error("missingConfigPath");
  const client = new BridgeClient(await loadConfig(path));
  const server = new Server({ name: Brand.Name, version: Brand.Version }, { capabilities: { tools: {} } });
  const tools = [
    ["requestSession", "Request a session under the extension policy; specify tabId to attach an existing tab", McpTools.SESSION],
    ["approvalStatus", "Check a pending session request", McpTools.APPROVAL],
    ["listTabs", "List session tabs", McpTools.TABS],
    ["createTab", "Create a tab in the session", McpTools.CREATE],
    ["closeTab", "Close a session-created tab", McpTools.PAGE],
    ["release", "Release a browser session", McpTools.RELEASE],
    ["observe", "Read the visible page state", McpTools.OBSERVE],
    ["fill", "Fill a selector with text", McpTools.FILL],
    ["click", "Click a selector", McpTools.CLICK],
    ["navigate", "Navigate a session page", McpTools.NAVIGATE],
    ["capabilities", "Get supported bridge capabilities", McpTools.EMPTY],
    ["availableTabs", "List existing HTTP(S) tabs when automatic access is enabled", McpTools.EMPTY],
  ] as const;
  server.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).ListToolsRequestSchema, async () => ({ tools: tools.map(([name, description], i) => ({ name, description, inputSchema: McpTools.SCHEMAS[i] })) }));
  server.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params;
    if (!(Rpc.METHODS as readonly string[]).includes(name)) throw new Error("unsupportedMethod");
    const item = tools.find(t => t[0] === name);
    if (!item) throw new Error("unsupportedMethod");
    const parsed = item[2].parse(args) as Record<string, unknown>;
    const result = await client.call(name as typeof Rpc.METHODS[number], parsed);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => client.close());
}

main().catch(() => { process.stderr.write("browserBridgeMcpFailed\n"); process.exitCode = 1; });
