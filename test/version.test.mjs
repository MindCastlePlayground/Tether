import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Install } from '../installer/constants.mjs';
import { Wire } from '../sandbox/constants.mjs';

test('installer, runtime, extension and broker publish one release version',()=>{
  const root=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
  const runtime=JSON.parse(fs.readFileSync(new URL('../prototype/package.json',import.meta.url)));
  const manifest=JSON.parse(fs.readFileSync(new URL('../prototype/extension/manifest.json',import.meta.url)));
  const protocol=fs.readFileSync(new URL('../prototype/src/protocol.ts',import.meta.url),'utf8');
  assert.match(root.version,/^\d+\.\d+\.\d+$/);
  assert.equal(runtime.version,root.version);
  assert.equal(manifest.version,root.version);
  assert.equal(Install.VERSION,root.version);
  assert.equal(Wire.Version,root.version);
  assert.ok(fs.readFileSync(new URL('../sandbox/compose.yaml',import.meta.url),'utf8').includes(`image: tether-sandbox:${root.version}`));
  assert.ok(protocol.includes(`Version = '${root.version}'`));
});
