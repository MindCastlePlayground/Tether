import test from 'node:test';
import assert from 'node:assert/strict';
import { Finder } from '../dist/locator.js';
import { Refs } from '../dist/refs.js';

test('snapshot issues all references in one browser batch', async () => {
  const batch = Refs.batch;
  let calls = 0, count = 0;
  Refs.batch = async (_page, refs) => {
    calls++; count = refs.length;
    return new Map(refs.map(ref => [ref, `t123e${ref.slice(1)}`]));
  };
  const page = {
    ariaSnapshot: async () => Array.from({ length: 200 }, (_, i) => `- button "B${i}" [ref=e${i}]`).join('\n'),
    getByRef: ref => ref,
    url: () => 'https://example.test/',
    title: async () => 'Many controls'
  };
  try {
    const result = await Finder.snapshot(page, {});
    assert.equal(count, 200);
    assert.equal(result.refs, 200);
    assert.equal(calls, 1);
  } finally { Refs.batch = batch; }
});
