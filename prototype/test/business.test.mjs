import test from 'node:test';
import assert from 'node:assert/strict';
import { Business, BusinessLimit, BusinessMethod } from '../dist/business.js';

class UploadPage {
  constructor() {
    this.file = { files: null, events: [], dispatchEvent: event => this.file.events.push(event.type) };
    this.loc = { count: async () => 1, getAttribute: async () => 'file', elementHandle: async () => ({ evaluate: async (fn, arg) => fn(this.file, arg), dispose: async () => {} }) };
  }
  locator() { return this.loc; }
  async evaluate(fn, arg) { return fn(arg); }
  on() {}
}

test('upload transfers bounded chunks and assembles a File without a large RPC argument', async () => {
  const prev = globalThis.__tetherUpload;
  const prevTransfer = globalThis.DataTransfer;
  class Transfer { constructor(){this.items={add:x=>this.files.push(x)};this.files=[];} }
  globalThis.DataTransfer = Transfer;
  const bytes = Buffer.from(Array.from({length: 80_000}, (_, i) => i % 251));
  const page = new UploadPage();
  const business = new Business(page, 'key');
  try {
    const {uploadId, chunkBytes} = await business.run(BusinessMethod.UploadStart, {files:[{name:'fixture.bin',size:bytes.length,mimeType:'application/octet-stream'}]});
    assert.equal(chunkBytes, BusinessLimit.ChunkBytes);
    for(let offset=0;offset<bytes.length;){
      const part=bytes.subarray(offset,offset+chunkBytes);
      assert.ok(part.toString('base64').length<=32768);
      await business.run(BusinessMethod.UploadChunk,{uploadId,fileIndex:0,offset,data:part.toString('base64')});
      offset+=part.length;
    }
    const result=await business.run(BusinessMethod.UploadFinish,{uploadId,selector:'input[type=file]'});
    assert.equal(result.sideEffect,'applied');
    assert.equal(page.file.files[0].name,'fixture.bin');
    assert.deepEqual(Buffer.from(await page.file.files[0].arrayBuffer()),bytes);
    assert.deepEqual(page.file.events,['input','change']);
  } finally {
    business.close();
    globalThis.__tetherUpload=prev;
    globalThis.DataTransfer=prevTransfer;
  }
});
