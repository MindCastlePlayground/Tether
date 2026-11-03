import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { Html, HtmlCode } from '../dist/html.js';

class PageStub {
  constructor(html){this.context={document:{doctype:null,documentElement:{outerHTML:html},title:'Example'},location:{href:'https://example.test/'}};this.disposed=0;}
  async evaluateHandle(fn){
    const value=runInNewContext(`(${fn.toString()})()`,this.context);
    assert.equal(typeof value,'object','capture must be an object handle: primitive strings cross the CDP wire in full');
    return {evaluate:async(fn,arg)=>runInNewContext(`(${fn.toString()})(value,arg)`,{...this.context,value,arg}),dispose:async()=>{this.disposed++;}};
  }
  set(next,navigate=false){if(navigate)this.context.document={...this.context.document,documentElement:{outerHTML:next.html}};else this.context.document.documentElement.outerHTML=next.html;}
}
function mockPage(initial){const page=new PageStub(initial.html);return{page,set:(next,navigate)=>page.set(next,navigate)};}
const doc=html=>({html});

test('returns full serialized capture across pages and retains it across DOM changes', async () => {
  const { page, set } = mockPage(doc('<!DOCTYPE html><html><body>before</body></html>'));
  const first = await Html.read(page, { offset: 0, maxChars: 15 });
  assert.equal(first.scope, 'main-document');
  assert.equal(first.complete, false);
  set(doc('<!DOCTYPE html><html><body>after</body></html>'));
  let result = first;
  let joined = first.html;
  while (result.nextOffset !== null) {
    result = await Html.read(page, { captureId: first.captureId, offset: result.nextOffset, maxChars: 15 });
    joined += result.html;
  }
  assert.equal(joined, '<!DOCTYPE html><html><body>before</body></html>');
  assert.equal(result.complete, true);
});

test('rejects missing/stale captures and detects main document replacement', async () => {
  const { page, set } = mockPage(doc('<html><body>x</body></html>'));
  await assert.rejects(Html.read(page, { offset: 1 }), { message: HtmlCode.Capture });
  const first = await Html.read(page, { offset: 0 });
  set(doc('<html><body>y</body></html>'), true);
  await assert.rejects(Html.read(page, { captureId: first.captureId, offset: first.nextOffset }), { message: HtmlCode.Stale });
});

test('expires captures after the retention window', async () => {
  const { page } = mockPage(doc('<html><body>x</body></html>'));
  const first = await Html.read(page, { offset: 0 });
  const now = Date.now;
  Date.now = () => now() + 60_001;
  try {
    await assert.rejects(Html.read(page, { captureId: first.captureId, offset: 0 }), { message: HtmlCode.Stale });
  } finally {
    Date.now = now;
  }
});

test('rejects captures above the configured size without truncating', async () => {
  const { page } = mockPage(doc('x'.repeat(8 * 1024 * 1024 + 1)));
  await assert.rejects(Html.read(page, { offset: 0 }), { message: HtmlCode.TooLarge });
});

test('HTML script contents remain inert data and capture resources are released',async()=>{
  const source='<html><script>globalThis.executed=true</script><input value="secret"></html>';
  const {page}=mockPage(doc(source));
  const first=await Html.read(page,{});
  assert.equal(first.html,source);
  assert.equal(page.context.executed,undefined);
  await Html.drop(page);
  assert.equal(page.disposed,1);
  await assert.rejects(Html.read(page,{captureId:first.captureId}),/html_capture_expired/);
});

test('a wrong capture ID does not discard the current capture',async()=>{
  const {page}=mockPage(doc('<html>stable</html>'));
  const first=await Html.read(page,{});
  await assert.rejects(Html.read(page,{captureId:'wrong'}),/html_capture_expired/);
  assert.equal((await Html.read(page,{captureId:first.captureId})).html,first.html);
  await Html.drop(page);
});
