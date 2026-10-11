import {Client}from'@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport}from'@modelcontextprotocol/sdk/client/stdio.js';
import{resolve}from'node:path';
import{writeFileSync,mkdirSync}from'node:fs';
const transport=new StdioClientTransport({command:resolve('.local/mcp.exe'),stderr:'pipe'});
const client=new Client({name:'m0-verifier',version:'0.1.0'});
transport.stderr?.on('data',d=>process.stderr.write(d));
try{await client.connect(transport);const tools=await client.listTools();const result=await client.callTool({name:'capabilities',arguments:{}});const evidence={at:new Date().toISOString(),tools:tools.tools.map(x=>x.name),result};mkdirSync('evidence',{recursive:true});writeFileSync('evidence/mcp.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}finally{await client.close();}
