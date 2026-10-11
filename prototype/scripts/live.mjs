import{BridgeClient,loadConfig}from'../dist/client.js';
import{writeFileSync,mkdirSync}from'node:fs';
import{resolve}from'node:path';
import{Client}from'@modelcontextprotocol/sdk/client/index.js';
import{StdioClientTransport}from'@modelcontextprotocol/sdk/client/stdio.js';
const mode=process.argv[2]??'newGroup';
const source=process.argv[3]??'node';
let mcp;
const client=source==='mcp'?new Proxy({}, {get:(_,method)=>method==='close'?()=>mcp?.close():async args=>{
 const r=await mcp.callTool({name:method,arguments:args??{}});if(r.isError)throw Error('mcp_tool_failed');return JSON.parse(r.content[0].text);
}}):new BridgeClient(await loadConfig('.local/script.json'));
const other=new BridgeClient(await loadConfig('.local/intruder.json'));
const evidence={mode,source,at:new Date().toISOString(),checks:[]};
mkdirSync('evidence',{recursive:true});
try{
 if(source==='mcp'){mcp=new Client({name:'browser-live-verifier',version:'0.1.0'});await mcp.connect(new StdioClientTransport({command:resolve('.local/mcp.exe'),stderr:'pipe'}));}
 if(!(await client.capabilities()).browserConnected)throw Error('extension_not_connected');
 const request={mode,url:'http://127.0.0.1:18444/'};
 let originalGroup;
 if(mode==='attachExisting'){
  const tabs=(await client.availableTabs()).tabs;
  const target=tabs.find(t=>t.url==='http://127.0.0.1:18444/'&&t.title==='Browser Bridge Local Test');
  if(!target)throw Error('fixture_tab_missing');
  request.tabId=target.tabId;
  originalGroup=target.groupId;
  evidence.checks.push({name:'existing_tab_discovered',pass:true,tabId:target.tabId});
 }
 let pending=await client.requestSession(request);console.log('session_requested');
 let approved;
 for(let i=0;i<600;i++){const r=await client.approvalStatus({pendingId:pending.pendingId});if(r.status==='approved'){approved=r;break;}if(r.status==='expired'){pending=await client.requestSession(request);console.log('approval_renewed');}else if(r.status!=='pending')throw Error('approval_'+r.status);if(i%30===0)console.log('extension_status:'+r.status);await new Promise(r=>setTimeout(r,1000));}
 if(!approved)throw Error('approval_timeout');
 const ids={sessionId:approved.sessionId,pageId:approved.pages[0].pageId};
 evidence.checks.push({name:'session_authorized',pass:true,groupId:approved.groupId});
 if(mode==='attachExisting')evidence.checks.push({name:'existing_group_preserved',pass:approved.groupId===originalGroup});
 if(mode==='newGroup'&&!(approved.groupId>=0))throw Error('missing_task_group');
 let fixture=false;
 for(let i=0;i<50;i++){const tabs=await client.listTabs({sessionId:ids.sessionId});if(tabs.pages.find(p=>p.pageId===ids.pageId)?.url?.startsWith('http://127.0.0.1:18444/')){fixture=true;break;}await new Promise(r=>setTimeout(r,100));}
 if(!fixture)throw Error('fixture_page_required');
 const initial=await client.observe(ids);evidence.checks.push({name:'playwright_observe',pass:initial.engine==='playwright-core',url:initial.url});
 const fill=await client.fill({...ids,seq:1,selector:'#name',value:'M0 script verified'});evidence.checks.push({name:'fill_applied',pass:fill.sideEffect==='applied'});
 const click=await client.click({...ids,seq:2,selector:'#save'});evidence.checks.push({name:'click_applied',pass:click.sideEffect==='applied'});
 const after=await client.observe(ids);evidence.checks.push({name:'fill_click_result',pass:after.text.includes('saved: M0 script verified')});
 try{await other.observe(ids);evidence.checks.push({name:'cross_client_denied',pass:false});}catch(e){evidence.checks.push({name:'cross_client_denied',pass:e.message==='not_authorized',reason:e.message});}
 if(mode==='attachExisting'){
  const competing=await other.requestSession({mode,tabId:request.tabId});
  const status=await other.approvalStatus({pendingId:competing.pendingId});
  evidence.checks.push({name:'concurrent_tab_claim_denied',pass:status.status==='denied'});
 }
 const created=await client.createTab({sessionId:ids.sessionId,seq:3,url:'http://127.0.0.1:18444/second'});evidence.checks.push({name:'create_tab',pass:!!created.pageId});
 await client.closeTab({sessionId:ids.sessionId,pageId:created.pageId,seq:4});
 await client.release({sessionId:ids.sessionId,seq:5});
 if(mode==='attachExisting')evidence.checks.push({name:'existing_tab_retained',pass:(await client.availableTabs()).tabs.some(t=>t.tabId===request.tabId)});
 try{await client.observe(ids);evidence.checks.push({name:'released_denied',pass:false});}catch{evidence.checks.push({name:'released_denied',pass:true});}
 if(evidence.checks.some(x=>!x.pass))throw Error('check_failed');
}catch(e){evidence.error=e.message;process.exitCode=1;console.log('live_failed:'+e.message);}finally{await client.close();other.close();writeFileSync(`evidence/live-${mode}-${source}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
