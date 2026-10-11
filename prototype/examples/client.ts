import { BridgeClient, loadConfig } from "../src/client.js";

async function main(): Promise<void> {
  const path = process.env.BB_CLIENT_CONFIG;
  if (!path) throw new Error("missingConfigPath");
  const client = new BridgeClient(await loadConfig(path));
  try { process.stdout.write(`${JSON.stringify(await client.capabilities())}\n`); }
  finally { client.close(); }
}
main().catch(() => { process.stderr.write("browserBridgeExampleFailed\n"); process.exitCode = 1; });
