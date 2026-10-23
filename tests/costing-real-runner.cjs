/* eslint-disable @typescript-eslint/no-require-imports -- Standalone disposable Docker/Node runner. */
// Real schema/SQL acceptance only. This does NOT generate or accept a release migration.
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const path = require('node:path');
const sdk = require('@neondatabase/serverless');
if (process.env.PRO_ERP_COSTING_REAL !== '1') throw new Error('Explicit PRO_ERP_COSTING_REAL=1 is required');
const root = path.resolve(__dirname, '..');
const nonce = randomBytes(6).toString('hex');
const label = 'pro-erp-costing-qa-' + nonce;
const pg = label + '-pg', ws = label + '-ws', network = label + '-internal', ingress = label + '-ingress';
const password = randomBytes(32).toString('hex');
const user = 'pro_erp_costing_qa';
const connectionString = `postgresql://${user}:${encodeURIComponent(password)}@${pg}:5432/${user}?sslmode=disable`;
const docker = (...args) => execFileSync('docker', args, { encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,POSTGRES_PASSWORD:password} }).trim();
const resources = [];
let bridge, pool, closing = false, stage = 'image discovery';
async function main() {
 for (const image of ['postgres:17-alpine','ghcr.io/neondatabase/wsproxy:latest']) docker('image','inspect',image,'--format','{{.Id}}');
 docker('network','create','--internal','--label',`task=${label}`,network);resources.push(['network',network]);
 docker('network','create','--label',`task=${label}`,ingress);resources.push(['network',ingress]);
 docker('run','-d','--pull=never','--name',pg,'--label',`task=${label}`,'--network',network,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_USER=${user}`,'-e',`POSTGRES_DB=${user}`,'-e','POSTGRES_PASSWORD','postgres:17-alpine');resources.push(['container',pg]);
 docker('run','-d','--pull=never','--name',ws,'--label',`task=${label}`,'--network',ingress,'-p','127.0.0.1::80','-e',`ALLOW_ADDR_REGEX=^${pg}:5432$`,'-e','LISTEN_PORT=:80','ghcr.io/neondatabase/wsproxy:latest');resources.push(['container',ws]);
 docker('network','connect',network,ws);
 let ready=false;
 for(let i=0;i<40;i++){try{docker('exec',pg,'pg_isready','-U',user,'-d',user);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
 if(!ready) throw new Error('Disposable PostgreSQL not ready');
 const binding=docker('port',ws,'80/tcp');if(!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected proxy binding');
 sdk.neonConfig.wsProxy=(host,port)=>{if(host!==pg||String(port)!=='5432')throw new Error('Unsafe WS target');return `${binding}/v1?address=${pg}:5432`;};
 sdk.neonConfig.webSocketConstructor=WebSocket;sdk.neonConfig.useSecureWebSocket=false;sdk.neonConfig.pipelineConnect=false;sdk.neonConfig.poolQueryViaFetch=false;
 pool=new sdk.Pool({connectionString,max:8,connectionTimeoutMillis:10000});
 pool.on('error',()=>{ if (!closing) { console.error('Disposable costing pool transport error (details withheld)'); process.exitCode=1; } });
 stage='verify real WS database identity';
 const identity=(await pool.query('select current_database() db, current_user usr')).rows[0];if(identity.db!==user||identity.usr!==user)throw new Error('Actual target mismatch');
 // Export current schema without credentials/config/lineage changes. Empty disposable DB only.
 stage='export current schema';
 const sql=execFileSync(process.execPath,[path.join(root,'node_modules/drizzle-kit/bin.cjs'),'export','--dialect','postgresql','--schema','./src/db/schema/index.ts'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(!sql.startsWith('CREATE TYPE')&&!sql.startsWith('CREATE TABLE'))throw new Error('Unexpected schema export format');
 stage='apply schema to empty disposable DB';
 await pool.query(sql);
 const rawTypes={getTypeParser:()=>value=>value};
 bridge=createServer(async(req,res)=>{
  let client;
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   if(req.method!=='POST'||req.url!=='/sql'||req.headers['neon-connection-string']!==connectionString) return send(403,{message:'Blocked'});
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4000000)throw new Error('Payload too large');chunks.push(c);}
   const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(Array.isArray(payload.queries))throw new Error('Batch transport not needed in this suite');
   if(typeof payload.query!=='string'||!Array.isArray(payload.params))throw new Error('Invalid SQL request');
   client=await pool.connect();const result=await client.query({text:payload.query,values:payload.params,rowMode:'array',types:rawTypes});send(200,result);
  }catch(e){send(400,{message:'Disposable SQL request failed',code:e.code});}finally{client?.release();}
 });
 await new Promise((resolve,reject)=>{bridge.once('error',reject);bridge.listen(0,'127.0.0.1',resolve);});
 const http=`http://127.0.0.1:${bridge.address().port}/sql`;
 console.log('Disposable costing DB ready; current schema exported into empty DB. No release migration applied.');
 const env={...process.env,DATABASE_URL:connectionString,DB_LOCAL_PROXY_URL:'',PRO_ERP_COSTING_DB_HOST:pg,PRO_ERP_COSTING_WS:binding,PRO_ERP_COSTING_HTTP:http,JWT_SECRET:randomBytes(32).toString('hex')};
 const child=spawn(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run','--config','tests/costing-real.vitest.config.ts','--reporter','verbose'],{cwd:root,env,stdio:'inherit'});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}
main().catch(e=>{console.error('Disposable costing runner failed at '+stage+': '+String(e.message || e.name || 'transport failure').replaceAll(password,'[redacted]'));try{console.error('Proxy diagnostic: '+docker('logs',ws).replaceAll(password,'[redacted]').slice(-2000));}catch{}process.exitCode=1;}).finally(async()=>{
 closing=true;
 if(bridge)await new Promise(resolve=>bridge.close(resolve));if(pool)await pool.end();
 for(const [kind,name]of resources.reverse()){
  try{const actual=docker(kind,'inspect',name,'--format',kind==='container'?'{{index .Config.Labels "task"}}':'{{index .Labels "task"}}');if(actual!==label)throw new Error('Ownership mismatch');docker(kind,'rm',...(kind==='container'?['-f']:[]),name);}catch(e){console.error('Cleanup failed for owned resource '+name+': '+String(e.message).replaceAll(password,'[redacted]'));process.exitCode=1;}
 }
 console.log('Disposable costing resource cleanup finished; production and existing containers untouched.');
});
