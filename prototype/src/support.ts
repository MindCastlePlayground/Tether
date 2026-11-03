import { Method, type Params } from './protocol.js';

export class Support {
  static readonly Diagnose = 'diagnose';
  static readonly Wait = 'wait';
  static readonly Assert = 'assert';
  static readonly Records = 'records';
  static readonly Methods = [Support.Diagnose,Support.Wait,Support.Assert,Support.Records];
  static readonly Conditions = ['text','url','visible','hidden','request'];
  static readonly Ops = ['list','export','clear'];
  static readonly Limit = 200;
}

export class Journal {
  private rows = new Map<string,Params[]>();
  add(client:string,method:string,start:number,result?:Params,error?:string):void {
    if(method===Support.Records)return;
    const rows=this.rows.get(client)??[];
    // Store operational metadata only: no URLs, selectors, payloads or page content.
    const raw=error??result?.error;
    const code=raw===undefined?undefined:typeof raw==='string'&&/^[a-zA-Z_]{1,80}$/.test(raw)?raw:'request_failed';
    rows.push({at:new Date(start).toISOString(),method:/^[a-zA-Z]{1,40}$/.test(method)?method:'invalid',durationMs:Date.now()-start,status:code?'failed':'ok',code,sideEffect:result?.sideEffect});
    this.rows.set(client,rows.slice(-Support.Limit));
  }
  read(client:string,op:string):Params {
    if(!Support.Ops.includes(op))throw Error('invalid_params');
    if(op==='clear'){this.rows.delete(client);return {cleared:true};}
    const rows=this.rows.get(client)??[];
    if(op==='export')return {filename:'tether-diagnostics.json',mimeType:'application/json',text:JSON.stringify({schemaVersion:1,records:rows},null,2)};
    return {records:rows,limit:Support.Limit};
  }
  drop(client:string):void {this.rows.delete(client);}
}

export class Conditions {
  static async run(p:Params,read:(method:string,p:Params)=>Promise<Params>):Promise<Params>{
    if(!Support.Conditions.includes(p.condition)||typeof p.sessionId!=='string'||!p.sessionId||typeof p.pageId!=='string'||!p.pageId||typeof p.value!=='string'||!p.value.length||p.value.length>2000)throw Error('invalid_params');
    const timeout=p.timeoutMs??5000;
    if(!Number.isInteger(timeout)||timeout<0||timeout>15000)throw Error('invalid_params');
    const start=Date.now();
    do {
      let matched=false;
      if(p.condition==='text'||p.condition==='url'){
        const result=await read(Method.Snapshot,{sessionId:p.sessionId,pageId:p.pageId});
        if(result.error)throw Error(result.error);
        matched=p.condition==='text'?result.tree.includes(p.value):result.url===p.value;
      }else if(p.condition==='request'){
        const result=await read('network',{...p,op:'list',url:p.value,limit:100});
        const rows=result.requests;
        if(!Array.isArray(rows))throw Error('invalid_response');
        matched=rows.some((r:Params)=>r.finished===true&&!r.failed);
      }else{
        const result=await read('locate',{sessionId:p.sessionId,pageId:p.pageId,clientId:p.clientId,selector:p.value});
        if(result.error)throw Error(result.error);
        const rows=result.candidates;
        if(!Array.isArray(rows))throw Error('invalid_response');
        matched=p.condition==='visible'?rows.some((r:Params)=>r.visible===true):!result.truncated&&!rows.some((r:Params)=>r.visible===true);
      }
      if(matched)return {passed:true,condition:p.condition,elapsedMs:Date.now()-start,sideEffect:'none'};
      if(Date.now()-start>=timeout)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(true);
    return {passed:false,error:'condition_timeout',condition:p.condition,elapsedMs:Date.now()-start,sideEffect:'none'};
  }
}
