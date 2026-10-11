import test from "node:test";
import assert from "node:assert/strict";
import { BridgeClient, ClientError } from "../dist/client.js";

const cfg = (url = "wss://127.0.0.1:9443/bridge") => ({ url, token: "opaque", caFile: "ca.pem", pin: "A".repeat(43) + "=" });

test("client requires WSS, numeric RFC1918 or loopback address, CA and SPKI pin", () => {
  assert.doesNotThrow(() => new BridgeClient(cfg()));
  assert.doesNotThrow(() => new BridgeClient(cfg("wss://192.168.1.23:9443/bridge")));
  for (const url of ["ws://127.0.0.1:9443", "wss://localhost:9443", "wss://8.8.8.8:9443", "wss://100.64.0.1:9443"]) {
    assert.throws(() => new BridgeClient(cfg(url)), ClientError);
  }
});

test("client refuses RPC methods outside the public allowlist", async () => {
  const c = new BridgeClient(cfg());
  await assert.rejects(c.call("Browser.close", {}), /unsupportedMethod/);
});
