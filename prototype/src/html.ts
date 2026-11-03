import { randomUUID } from 'node:crypto';
import type { Page, JSHandle } from 'playwright-core';
import type { Params } from './protocol.js';

export class HtmlLimit {
  static readonly Default=16_000;
  static readonly Page=30_000;
  static readonly Capture=8*1024*1024;
  static readonly Age=60_000;
  static readonly Scope='main-document';
}
export class HtmlCode {
  static readonly Invalid='html_invalid_request';
  static readonly Capture='html_capture_required';
  static readonly Stale='html_capture_expired';
  static readonly TooLarge='html_too_large';
}
interface DocumentCapture {html:string;doc:Document;url:string;title:string}
interface Capture {id:string;handle:JSHandle<DocumentCapture>;totalChars:number;url:string;title:string;time:number;timer:NodeJS.Timeout}

/** The object handle keeps the full string in Chrome, below Native Messaging's per-frame limit. */
export class Html {
  private static readonly captures=new WeakMap<Page,Capture>();
  static async drop(page:Page):Promise<void>{
    const cap=this.captures.get(page);this.captures.delete(page);
    if(cap){clearTimeout(cap.timer);await cap.handle.dispose().catch(()=>{});}
  }
  static async read(page:Page,p:Params):Promise<Params>{
    const offset=p.offset??0,max=p.maxChars??HtmlLimit.Default;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(max)||max<1||max>HtmlLimit.Page)throw Error(HtmlCode.Invalid);
    let cap=this.captures.get(page);
    if(p.captureId!==undefined){
      if(typeof p.captureId!=='string'||!cap||cap.id!==p.captureId)throw Error(HtmlCode.Stale);
      if(Date.now()-cap.time>=HtmlLimit.Age){await this.drop(page);throw Error(HtmlCode.Stale);}
    }else{
      if(offset!==0)throw Error(HtmlCode.Capture);
      await this.drop(page);
      const handle=await page.evaluateHandle(()=>{
        const d=document.doctype;
        const prefix=d?`<!DOCTYPE ${d.name}${d.publicId?` PUBLIC "${d.publicId}"`:''}${d.systemId?`${d.publicId?'':' SYSTEM'} "${d.systemId}"`:''}>`:'';
        return {html:prefix+document.documentElement.outerHTML,doc:document,url:location.href,title:document.title};
      });
      try{
        const meta=await handle.evaluate(v=>({totalChars:v.html.length,url:v.url,title:v.title}));
        if(meta.totalChars>HtmlLimit.Capture)throw Error(HtmlCode.TooLarge);
        const id=randomUUID();
        const timer=setTimeout(()=>{if(this.captures.get(page)?.id===id)void this.drop(page);},HtmlLimit.Age);
        timer.unref();
        cap={id,handle,...meta,time:Date.now(),timer};this.captures.set(page,cap);
      }catch(e){await handle.dispose().catch(()=>{});throw e;}
    }
    if(offset>cap.totalChars)throw Error(HtmlCode.Invalid);
    const end=Math.min(offset+max,cap.totalChars);
    const chunk=await cap.handle.evaluate((v,r)=>v.doc===document?v.html.slice(r.start,r.end):null,{start:offset,end}).catch(()=>null);
    if(chunk===null){await this.drop(page);throw Error(HtmlCode.Stale);}
    return {html:chunk,captureId:cap.id,offset,nextOffset:end<cap.totalChars?end:null,totalChars:cap.totalChars,complete:end===cap.totalChars,url:cap.url,title:cap.title,scope:HtmlLimit.Scope};
  }
}
