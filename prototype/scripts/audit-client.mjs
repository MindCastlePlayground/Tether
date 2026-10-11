import{BridgeClient,loadConfig}from'../dist/client.js';
const c=new BridgeClient(await loadConfig('.local/python.json'));
try{await c.capabilities();await new Promise(r=>setTimeout(r,10000));}finally{c.close();}
