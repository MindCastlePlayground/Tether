import { readFileSync, statSync } from 'node:fs';
import { Action, Effect, PolicyKey as K } from './protocol.js';

export class Policy {
  private stamp?:string;private data:any;private valid=true;
  constructor(private file:string){}
  private origin(value:string,pattern=false):URL {
    if(typeof value!=='string'||!/^\w[\w+.-]*:\/\/[^/?#]+$/.test(value))throw Error(K.Invalid);
    const wild=pattern&&value.includes(K.Wild);
    const url=new URL(wild?value.replace('://*.','://'):value);
    if(url.origin==='null'||url.username||url.password||url.hostname.includes('*')||(wild&&!value.includes('://*.')))throw Error(K.Invalid);
    return url;
  }
  private load():void {
    try {
      let stamp:string;
      try{const s=statSync(this.file);stamp=`${s.mtimeMs}/${s.ctimeMs}/${s.size}`;}
      catch(e){if((e as NodeJS.ErrnoException).code!==K.Missing)throw e;stamp=K.Missing;}
      if(stamp===this.stamp)return;this.stamp=stamp;
      const d=stamp===K.Missing?{[K.Version]:1,[K.Default]:Effect.Allow,[K.Rules]:[]}:JSON.parse(readFileSync(this.file,'utf8'));
      if(!d||d[K.Version]!==1||![Effect.Allow,Effect.Deny].includes(d[K.Default])||!Array.isArray(d[K.Rules]))throw Error(K.Invalid);
      for(const r of d[K.Rules]){
        if(!r||typeof r[K.Id]!=='string'||!r[K.Id]||typeof r[K.Client]!=='string'||!r[K.Client]||typeof r[K.Origin]!=='string'||!Array.isArray(r[K.Actions])||!r[K.Actions].length||!r[K.Actions].every((a:any)=>a===K.Any||Object.values(Action).includes(a))||!Object.values(Effect).includes(r[K.Effect]))throw Error(K.Invalid);
        if(r[K.Effect]===Effect.Ask&&(r[K.Actions].length!==1||r[K.Actions][0]!==Action.Session))throw Error(K.Invalid);
        if(r[K.Origin]!==K.Any)this.origin(r[K.Origin],true);
      }
      this.data=d;this.valid=true;
    }catch{this.valid=false;}
  }
  summary():{default:Effect;rules:number;valid:boolean}{this.load();return {default:this.valid?this.data[K.Default]:Effect.Deny,rules:this.valid?this.data[K.Rules].length:0,valid:this.valid};}
  check(client:string,action:Action|null,origin:string|null):Effect {
    this.load();if(!this.valid)throw Error(K.Invalid);
    if(action===null)return Effect.Allow;
    let url:URL|undefined;try{if(origin)url=new URL(origin);}catch{}
    for(const r of this.data[K.Rules]){
      if(r[K.Client]!==K.Any&&r[K.Client]!==client)continue;
      if(!r[K.Actions].includes(K.Any)&&!r[K.Actions].includes(action))continue;
      const o=r[K.Origin];
      if(o!==K.Any){
        if(!url||url.origin==='null')continue;const p=this.origin(o,true);
        const host=url.hostname.toLowerCase(),base=p.hostname.toLowerCase();
        if(url.protocol.toLowerCase()!==p.protocol.toLowerCase()||url.port!==p.port||(o.includes('://*.')?host!==base&&!host.endsWith('.'+base):host!==base))continue;
      }
      return r[K.Effect];
    }
    return this.data[K.Default];
  }
}
