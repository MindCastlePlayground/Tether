import { BusinessApi } from './business-api.js';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeClient, ClientError, loadConfig } from "./client.js";
import { Rpc, NetworkOp, SupportMethod } from "./client-constants.js";
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
  static readonly HTML = z.object({ sessionId:z.string(), pageId:z.string(), offset:z.number().int().nonnegative().optional(), maxChars:z.number().int().min(1).max(30000).optional(), captureId:z.string().min(1).max(100).optional() }).strict();
  static readonly NETWORK = z.object({ sessionId: z.string(), pageId: z.string(), op: z.enum(NetworkOp.All), requestId: z.string().optional(), url: z.string().optional(), type: z.string().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional(), maxChars: z.number().int().min(1).max(30000).optional() }).strict().refine(p => !([NetworkOp.Detail, NetworkOp.Body] as string[]).includes(p.op) || !!p.requestId, {message: 'requestIdRequired'});
  static readonly TARGET = (o: { selector?: string; ref?: string }) => (o.selector === undefined) !== (o.ref === undefined);
  static readonly OBSERVATION = z.object({ scope: z.string().optional(), scopeRef: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), maxChars: z.number().int().positive().optional() }).strict().refine(o => !(o.scope !== undefined && o.scopeRef !== undefined), { message: "scopeOrScopeRef" });
  static readonly FILL = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), selector: z.string().optional(), ref: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), value: z.string(), observe: McpTools.OBSERVATION.optional() }).refine(McpTools.TARGET, { message: "selectorOrRef" });
  static readonly CLICK = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), selector: z.string().optional(), ref: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), observe: McpTools.OBSERVATION.optional() }).refine(McpTools.TARGET, { message: "selectorOrRef" });
  static readonly SNAPSHOT = z.object({ sessionId: z.string(), pageId: z.string(), scope: z.string().optional(), scopeRef: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), outline: z.boolean().optional(), depth: z.number().int().positive().optional(), maxChars: z.number().int().positive().optional() }).refine(o => !(o.scope !== undefined && o.scopeRef !== undefined), { message: "scopeOrScopeRef" });
  static readonly LOCATE = z.object({ sessionId: z.string(), pageId: z.string(), text: z.string().optional(), role: z.string().optional(), name: z.string().optional(), exact: z.boolean().optional(), selector: z.string().optional(), ref: z.string().regex(/^[a-z0-9]{1,64}$/).optional(), scope: z.string().optional(), scopeRef: z.string().regex(/^[a-z0-9]{1,64}$/).optional() }).refine(o => !(o.scope !== undefined && o.scopeRef !== undefined), { message: "scopeOrScopeRef" });
  static readonly NAVIGATE = z.object({ sessionId: z.string(), pageId: z.string(), seq: z.number().int().positive(), url: z.string() });
  static readonly WAIT = z.object({sessionId:z.string(),pageId:z.string(),condition:z.enum(SupportMethod.Conditions),value:z.string().min(1).max(2000),timeoutMs:z.number().int().min(0).max(15000).optional()}).strict();
  static readonly RECORDS = z.object({op:z.enum(SupportMethod.RecordOps).optional()}).strict();

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
    [Method.Html, descriptions.html, McpTools.HTML],
    ["fill", descriptions.fill, McpTools.FILL],
    ["click", descriptions.click, McpTools.CLICK],
    ["navigate", descriptions.navigate, McpTools.NAVIGATE],
    ["capabilities", descriptions.capabilities, McpTools.EMPTY],
    ["availableTabs", descriptions.availableTabs, McpTools.EMPTY],
    ["snapshot", descriptions.snapshot, McpTools.SNAPSHOT],
    ["locate", descriptions.locate, McpTools.LOCATE],
    [Method.Network, descriptions.network, McpTools.NETWORK],
    [SupportMethod.Diagnose, descriptions.diagnose, McpTools.EMPTY],
    [SupportMethod.Wait, descriptions.wait, McpTools.WAIT],
    [SupportMethod.Assert, descriptions.assert, McpTools.WAIT],
    [SupportMethod.Records, descriptions.records, McpTools.RECORDS],
    ...BusinessApi.Names.map(name => [name, BusinessApi.Descriptions[name][I18n.language()==='zh-CN'?1:0], BusinessApi.Schemas[name]] as const),
  ] as const;
  server.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).ListToolsRequestSchema, async () => ({ tools: tools.map(([name,description,schema]) => ({name,description,inputSchema:z.toJSONSchema(schema) as any})) }));
  server.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params;
    if (!(Rpc.METHODS as readonly string[]).includes(name)) return {isError:true,content:[{type:'text',text:JSON.stringify({code:'unsupportedMethod'})}]};
    const item = tools.find(t => t[0] === name);
    if (!item) throw new Error("unsupportedMethod");
    let parsed: Record<string, unknown>;
    const run = async () => {
      if (name !== Method.Capabilities && name !== SupportMethod.Diagnose && name !== SupportMethod.Records) await wake.ready();
      return client.call(name as typeof Rpc.METHODS[number], parsed);
    };
    let result;
    try {
      const validation = item[2].safeParse(args);
      if (!validation.success) throw new ClientError('invalid_params');
      parsed = validation.data as Record<string, unknown>;
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
      const err = e as Error & { code?: string; rpcCode?: number };
      const hint = err.message === Wake.Missing ? McpHint.BROWSER[I18n.language()].replace("$1", () => folder) : undefined;
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: err.code ?? err.message, rpcCode: err.rpcCode, hint }) }] };
    }
    return { isError: !!result?.error || result?.passed === false, content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => client.close());
}

main().catch(() => { process.stderr.write("browserBridgeMcpFailed\n"); process.exitCode = 1; });
