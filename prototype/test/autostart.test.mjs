import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { dirname, join } from "node:path";
import { Autostart } from "../dist/autostart.js";
import { Autostart as Opt } from "../dist/protocol.js";

const cfg = join("rt", ".local", "agent.json");
const here = join("dist");
const broker = join(dirname(cfg), Opt.Broker);
const script = join(here, Opt.Script);
const read = (port) => () => JSON.stringify({ [Opt.Port]: port });
const noop = () => ({ unref() {} });

test("open port does not spawn", async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, Opt.Host, resolve); });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  let spawned = 0;
  try {
    await Autostart.run({ env: { [Opt.Client]: cfg }, read: read(addr.port), spawn: () => { spawned++; return noop(); } });
  } finally {
    await new Promise(resolve => server.close(() => resolve()));
  }
  assert.equal(spawned, 0);
});

test("BB_BROKER_AUTOSTART=0 skips probe and spawn", async () => {
  let spawned = 0, probed = 0;
  await Autostart.run({
    env: { [Opt.Client]: cfg, [Opt.Flag]: Opt.Off },
    read: () => { throw new Error("read"); },
    probe: async () => { probed++; return false; },
    spawn: () => { spawned++; return noop(); },
  });
  assert.equal(spawned, 0);
  assert.equal(probed, 0);
});

test("closed port spawns and returns when the probe succeeds", async () => {
  let seen = 0, spawned = 0, t = 0;
  const args = [];
  await Autostart.run({
    env: { [Opt.Client]: cfg },
    here,
    read: read(40123),
    probe: async () => ++seen > 1,
    spawn: (bin, got, opt) => { spawned++; args.push(bin, ...got, opt); return noop(); },
    wait: async (ms) => { t += ms; },
    now: () => t,
    write: () => { throw new Error("timeout"); },
  });
  assert.equal(spawned, 1);
  assert.equal(args[0], process.execPath);
  assert.equal(args[1], script);
  assert.equal(args[2], broker);
  assert.deepEqual(args[3], { detached: true, stdio: Opt.Ignore, windowsHide: true });
  assert.ok(seen >= 2);
});

test("timeout writes the marker and returns", async () => {
  let t = 0, line = "";
  await Autostart.run({
    env: { [Opt.Client]: cfg },
    here,
    read: read(9),
    probe: async () => false,
    spawn: () => noop(),
    wait: async (ms) => { t += ms; },
    now: () => t,
    write: (s) => { line = s; },
  });
  assert.equal(line, Opt.Timeout);
  assert.equal(t, Opt.Budget);
});
