import {BridgeClient,loadConfig} from '../dist/client.js';
const client=new BridgeClient(await loadConfig('.local/script.json'));
try{console.log(JSON.stringify(await client.capabilities()));}finally{client.close();}
