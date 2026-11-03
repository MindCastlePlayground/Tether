import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { Business, BusinessMethod as M } from '../dist/business.js';

class Fixture {
  static async start(handler) { const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{server,url:`http://127.0.0.1:${server.address().port}`}; }
  static async stop(server) { await new Promise(resolve=>server.close(resolve)); }
}

test('real Chromium file transfer, same-origin download stream, redirect refusal, and dialog control', async () => {
  const payload=Buffer.from(Array.from({length:100_000},(_,i)=>i%251));
  const other=await Fixture.start((req,res)=>{if(req.url==='/frame'){res.writeHead(200,{'content-type':'text/html'});res.end('<input type="file" id="frameFiles">');return;}res.writeHead(200,{'content-type':'application/octet-stream'});res.end(payload);});
  const app=await Fixture.start((req,res)=>{
    if(req.url==='/same-redirect'){res.writeHead(302,{location:'/file'});res.end();return;}
    if(req.url==='/redirect'){res.writeHead(302,{location:other.url+'/payload'});res.end();return;}
    if(req.url==='/file'){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="payload.bin"','content-length':payload.length});res.end(payload);return;}
    res.writeHead(200,{'content-type':'text/html'});res.end(`<input type="file" id="files"><iframe id="upload" src="${other.url}/frame"></iframe><button id="alert" onclick="alert('business dialog')">Alert</button>`);
  });
  let browser;let business;
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.TETHER_QA_CHROME});
    const page=await browser.newPage();await page.goto(app.url);
    business=new Business(page,'live');
    const file=Buffer.from('browser upload proof');
    const {uploadId,chunkBytes}=await business.run(M.UploadStart,{files:[{name:'proof.txt',size:file.length,mimeType:'text/plain'}]});
    for(let offset=0;offset<file.length;){const part=file.subarray(offset,offset+chunkBytes);await business.run(M.UploadChunk,{uploadId,fileIndex:0,offset,data:part.toString('base64')});offset+=part.length;}
    await business.run(M.UploadFinish,{uploadId,selector:'#files'});
    assert.deepEqual(await page.locator('#files').evaluate(async e=>({name:e.files[0].name,size:e.files[0].size,text: await e.files[0].text()})),{name:'proof.txt',size:file.length,text: file.toString()});
    const framed=Buffer.from('OOPIF upload proof');
    const staged=await business.run(M.UploadStart,{files:[{name:'frame.txt',size:framed.length,mimeType:'text/plain'}]});
    await business.run(M.UploadChunk,{uploadId:staged.uploadId,fileIndex:0,offset:0,data:framed.toString('base64')});
    await business.run(M.UploadFinish,{uploadId:staged.uploadId,selector:'frame=iframe#upload >> #frameFiles'});
    assert.equal(await page.frameLocator('#upload').locator('#frameFiles').evaluate(e=>e.files[0].name),'frame.txt');

    const download=await business.run(M.DownloadStart,{url:`${app.url}/same-redirect`});let output=Buffer.alloc(0),offset=0;
    for(;;){const part=await business.run(M.DownloadRead,{downloadId:download.downloadId,offset});output=Buffer.concat([output,Buffer.from(part.data,'base64')]);offset=part.nextOffset;if(part.done)break;assert.ok(Buffer.byteLength(part.data,'base64')<=24*1024);}
    assert.deepEqual(output,payload);
    await assert.rejects(business.run(M.DownloadStart,{url:`${app.url}/redirect`}),/download_fetch_failed/);

    const alert=page.locator('#alert').evaluate(e=>e.click());
    let dialogs=[];for(let i=0;i<50&&!dialogs.length;i++){dialogs=(await business.run(M.Dialog,{action:'list'})).dialogs;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(dialogs[0]?.message,'business dialog');
    await business.run(M.Dialog,{action:'accept',dialogId:dialogs[0].id});await alert;
  } finally { business?.close();await browser?.close();await Fixture.stop(app.server);await Fixture.stop(other.server); }
});
