import type { Page } from 'playwright-core';
import type { Params } from './protocol.js';

/** Business methods exposed by the optional Playwright engine adapter. */
export class BusinessMethod {
  static readonly UploadStart = 'uploadStart';
  static readonly UploadChunk = 'uploadChunk';
  static readonly UploadFinish = 'uploadFinish';
  static readonly UploadDrop = 'uploadDrop';
  static readonly DownloadStart = 'downloadStart';
  static readonly DownloadRead = 'downloadRead';
  static readonly DownloadDrop = 'downloadDrop';
  static readonly Dialog = 'dialog';
}

export class BusinessLimit {
  static readonly FileBytes = 16 * 1024 * 1024;
  static readonly UploadBytes = 32 * 1024 * 1024;
  static readonly DownloadBytes = 16 * 1024 * 1024;
  static readonly ChunkBytes = 24 * 1024;
  static readonly StoreBytes = 32 * 1024 * 1024;
  static readonly Files = 8;
  static readonly Name = 180;
  static readonly Mime = 120;
  static readonly StoreMs = 60_000;
  static readonly Dialogs = 32;
}

export class BusinessSelector {
  static readonly Frame='frame=';
  static readonly Delimiter=' >> ';
}

type Download = { reader: import('playwright-core').JSHandle; name: string; mime: string; total: number; offset: number; reserve:number; expires: number };
type Upload = { files: Array<{name:string;mimeType:string;size:number;parts:Buffer[];received:number}>; total:number; received:number; expires:number };
type Dialog = { id: string; type: string; message: string; defaultValue: string; handle: import('playwright-core').Dialog; timer: ReturnType<typeof setTimeout> };

/** Page scoped file operations and JavaScript dialog control. */
export class Business {
  private downloads = new Map<string, Download>();
  private uploads = new Map<string, Upload>();
  private storedBytes = 0;
  private downloadBytes = 0;
  private dialogs = new Map<string, Dialog[]>();

  constructor(private readonly page: Page, private readonly key: string) {
    page.on('dialog', dialog => {
      const items = this.dialogs.get(key) ?? [];
      const item = { id: crypto.randomUUID(), type: dialog.type(), message: dialog.message().slice(0, 2000), defaultValue: dialog.defaultValue().slice(0, 500), handle: dialog, timer: setTimeout(()=>{},0) };
      items.push(item);
      item.timer = setTimeout(() => { const current=this.dialogs.get(key); if(current?.includes(item)){current.splice(current.indexOf(item),1);void dialog.dismiss().catch(()=>{});} }, 15_000);
      if (items.length > BusinessLimit.Dialogs) { const old=items.shift()!;clearTimeout(old.timer);void old.handle.dismiss().catch(()=>{}); }
      this.dialogs.set(key, items);
    });
  }

  async run(method: string, p: Params): Promise<Params> {
    this.sweep();
    if (method === BusinessMethod.UploadStart) return this.uploadStart(p);
    if (method === BusinessMethod.UploadChunk) return this.uploadChunk(p);
    if (method === BusinessMethod.UploadFinish) return this.uploadFinish(p);
    if (method === BusinessMethod.UploadDrop) return this.uploadDrop(p);
    if (method === BusinessMethod.DownloadStart) return this.downloadStart(p);
    if (method === BusinessMethod.DownloadRead) return this.downloadRead(p);
    if (method === BusinessMethod.DownloadDrop) return this.downloadDrop(p);
    if (method === BusinessMethod.Dialog) return this.dialog(p);
    throw Error('unsupported_method');
  }

  private uploadStart(p: Params): Params {
    if(!Array.isArray(p.files)||!p.files.length||p.files.length>BusinessLimit.Files)throw Error('invalid_upload');
    const files=p.files.map((f:Params)=>{if(typeof f?.name!=='string'||!f.name||f.name.length>BusinessLimit.Name||/[\\/\0]/.test(f.name)||!Number.isSafeInteger(f.size)||f.size<0||f.size>BusinessLimit.FileBytes)throw Error('invalid_upload');return{name:f.name,mimeType:typeof f.mimeType==='string'&&f.mimeType.length<=BusinessLimit.Mime?f.mimeType:'application/octet-stream',size:f.size,parts:[],received:0};});
    const total=files.reduce((n:number,f:any)=>n+f.size,0);if(total>BusinessLimit.UploadBytes||this.storedBytes+total>BusinessLimit.StoreBytes)throw Error('upload_store_full');
    const id=crypto.randomUUID();this.uploads.set(id,{files,total,received:0,expires:Date.now()+BusinessLimit.StoreMs});this.storedBytes+=total;
    return{uploadId:id,chunkBytes:BusinessLimit.ChunkBytes};
  }

  private uploadChunk(p:Params):Params {
    const upload=this.uploads.get(p.uploadId);if(!upload||upload.expires<=Date.now())throw Error('upload_unavailable');
    const file=upload.files[p.fileIndex];if(!file||p.offset!==file.received||typeof p.data!=='string'||p.data.length>Math.ceil(BusinessLimit.ChunkBytes*4/3)+8||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.data))throw Error('invalid_upload_chunk');
    const part=Buffer.from(p.data,'base64');if(!part.length||part.length>BusinessLimit.ChunkBytes||file.received+part.length>file.size)throw Error('invalid_upload_chunk');
    file.parts.push(part);file.received+=part.length;upload.received+=part.length;upload.expires=Date.now()+BusinessLimit.StoreMs;
    return{nextOffset:file.received,complete:file.received===file.size};
  }

  private async uploadFinish(p: Params): Promise<Params> {
    const upload=this.uploads.get(p.uploadId);if(!upload||upload.expires<=Date.now()||upload.received!==upload.total||upload.files.some(f=>f.received!==f.size)||typeof p.selector!=='string'||!p.selector)throw Error('upload_incomplete');
    let handle:import('playwright-core').ElementHandle|null=null;const token=crypto.randomUUID();
    try {
      const loc=this.fileLocator(p.selector);
      if (await loc.count() !== 1 || await loc.getAttribute('type') !== 'file') throw Error('file_input_not_unique');
      handle=await loc.elementHandle();if(!handle)throw Error('file_input_not_unique');
      // Stage inside the selected element's frame so OOPIF controls work too.
      for(let i=0;i<upload.files.length;i++){
        const f=upload.files[i];
        await handle.evaluate((el:any,{token,index,name,type,size})=>{const root=globalThis as any;root.__tetherUpload??={};root.__tetherUpload[token]??=[];root.__tetherUpload[token][index]={name,type,size,parts:[]};},{token,index:i,name:f.name,type:f.mimeType,size:f.size});
        for(const part of f.parts)await handle.evaluate((el:any,{token,index,data})=>{(globalThis as any).__tetherUpload[token][index].parts.push(data);},{token,index:i,data:part.toString('base64')});
      }
      await handle.evaluate((el:any,token:string)=>{const entries=(globalThis as any).__tetherUpload[token];const files=entries.map((f:any)=>{const chunks=f.parts.map((x:string)=>Uint8Array.from(atob(x),c=>c.charCodeAt(0)));const bytes=new Uint8Array(f.size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}if(offset!==f.size)throw Error('upload_incomplete');return new File([bytes],f.name,{type:f.type});});const transfer=new DataTransfer();for(const file of files)transfer.items.add(file);el.files=transfer.files;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},token);
      return { sideEffect: 'applied', files: upload.files.map(f => ({ name: f.name, bytes: f.size })) };
    } finally {
      await handle?.evaluate((_el:any,t:string)=>{delete (globalThis as any).__tetherUpload?.[t];},token).catch(()=>{});
      await handle?.dispose();this.uploadDrop({uploadId:p.uploadId});
    }
  }

  private fileLocator(selector:string){
    if(selector.startsWith(BusinessSelector.Frame)){
      const parts=selector.slice(BusinessSelector.Frame.length).split(BusinessSelector.Delimiter);
      if(parts.length!==2||!parts[0]||!parts[1])throw Error('invalid_upload_selector');
      return this.page.frameLocator(parts[0]).locator(parts[1]);
    }
    return this.page.locator(selector);
  }

  private uploadDrop(p:Params):Params {const item=this.uploads.get(p.uploadId);if(!item)return{dropped:false};this.uploads.delete(p.uploadId);this.storedBytes-=item.total;return{dropped:true};}

  private async downloadStart(p: Params): Promise<Params> {
    if (typeof p.url !== 'string' || p.url.length > 4096) throw Error('invalid_download');
    const url = new URL(p.url, this.page.url());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== new URL(this.page.url()).origin) throw Error('download_origin_denied');
    const reader = await this.page.evaluateHandle(async ({ url, cap, origin }) => {
      let r:Response;
      // Fetch enforces same-origin on every redirect before sending a request.
      try{r=await fetch(url,{credentials:'same-origin',mode:'same-origin',redirect:'follow'});}
      catch{throw Error('download_fetch_failed');}
      if (!r.ok) throw Error(`download_http_${r.status}`);
      if(new URL(r.url).origin!==origin)throw Error('download_redirect_denied');
      const length=Number(r.headers.get('content-length')??0);if(length>cap)throw Error('download_too_large');
      const disposition = r.headers.get('content-disposition') ?? '';
      const name = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)?.[1] ?? url.split('/').pop() ?? 'download';
      if(!r.body)throw Error('download_empty');
      return { reader:r.body.getReader(), name, mime:r.headers.get('content-type')??'application/octet-stream', length, read:0, cap, pending:new Uint8Array() };
    }, { url: url.href, cap: BusinessLimit.DownloadBytes, origin:url.origin });
    const info=await reader.evaluate((x:any)=>({name:x.name,mime:x.mime,length:x.length}));
    const reserve=info.length||BusinessLimit.DownloadBytes;
    if(reserve>BusinessLimit.DownloadBytes||this.downloadBytes+reserve>BusinessLimit.StoreBytes){await reader.dispose();throw Error('download_store_full');}
    const id = crypto.randomUUID();
    this.downloads.set(id, { reader, name:info.name.slice(0,BusinessLimit.Name), mime:info.mime.slice(0,BusinessLimit.Mime), total:info.length, offset:0, expires:Date.now()+BusinessLimit.StoreMs, reserve } as Download);
    this.downloadBytes+=reserve;
    this.sweep();
    return { downloadId: id, name: info.name.slice(0, BusinessLimit.Name), mimeType: info.mime, bytes: info.length || null, chunkBytes: BusinessLimit.ChunkBytes };
  }

  private async downloadRead(p: Params): Promise<Params> {
    const item = this.downloads.get(p.downloadId);
    if (!item || item.expires <= Date.now()) { await this.dropDownload(p.downloadId); throw Error('download_unavailable'); }
    if (!Number.isSafeInteger(p.offset) || p.offset !== item.offset) throw Error('invalid_download_offset');
    let chunk:Params;
    try{chunk=await item.reader.evaluate(async (x:any,n:number)=>{if(!x.pending?.length){const r=await x.reader.read();if(r.done)return{done:true,data:''};x.pending=r.value;}const part=x.pending.subarray(0,n);x.pending=x.pending.subarray(part.length);x.read+=part.length;if(x.read>x.cap){await x.reader.cancel();throw Error('download_too_large');}let s='';for(let i=0;i<part.length;i+=0x8000)s+=String.fromCharCode(...part.subarray(i,i+0x8000));return{done:false,data:btoa(s)};},BusinessLimit.ChunkBytes);}
    catch(error){await this.dropDownload(p.downloadId);throw error;}
    const bytes=Buffer.from(chunk.data,'base64');if(bytes.length>BusinessLimit.ChunkBytes)throw Error('download_chunk_invalid');
    item.offset+=bytes.length;item.expires=Date.now()+BusinessLimit.StoreMs;
    if(chunk.done){item.total=item.offset;await this.dropDownload(p.downloadId);return{offset:p.offset,nextOffset:item.offset,totalBytes:item.total,done:true,data:''};}
    return{offset:p.offset,nextOffset:item.offset,totalBytes:item.total||null,done:false,data:chunk.data};
  }

  private async downloadDrop(p: Params): Promise<Params> {const dropped=await this.dropDownload(p.downloadId);return{dropped};}
  private async dropDownload(id:string):Promise<boolean>{const item=this.downloads.get(id);if(!item)return false;this.downloads.delete(id);this.downloadBytes-=item.reserve;await item.reader.evaluate(async(x:any)=>{await x.reader.cancel();}).catch(()=>{});await item.reader.dispose();return true;}
  private sweep():void{const now=Date.now();for(const [id,x]of this.downloads)if(x.expires<=now)void this.dropDownload(id);for(const [id,x]of this.uploads)if(x.expires<=now)this.uploadDrop({uploadId:id});}

  private async dialog(p: Params): Promise<Params> {
    const items = this.dialogs.get(this.key) ?? [];
    if (p.action === 'list') return { dialogs: items.map(({id,type,message,defaultValue}) => ({id,type,message,defaultValue})) };
    const i = items.findIndex(x => x.id === p.dialogId);
    if (i < 0 || !['accept', 'dismiss'].includes(p.action)) throw Error('dialog_unavailable');
    const [item] = items.splice(i, 1);
    this.dialogs.set(this.key, items);
    clearTimeout(item.timer);
    try{
      if(p.action==='accept') await item.handle.accept(typeof p.promptText==='string'?p.promptText.slice(0,2000):undefined);
      else await item.handle.dismiss();
    }catch{throw Error('dialog_unavailable');}
    return { sideEffect: 'applied', action: p.action };
  }

  closedDialog():void {const item=this.dialogs.get(this.key)?.shift();if(item)clearTimeout(item.timer);}

  close(): void { for(const id of this.downloads.keys())void this.dropDownload(id);for(const id of this.uploads.keys())this.uploadDrop({uploadId:id});const items=this.dialogs.get(this.key)??[];this.dialogs.delete(this.key);for(const item of items){clearTimeout(item.timer);void item.handle.dismiss().catch(()=>{});} }
}
