// Requires a built Flutter client, a Redis test server and Playwright Chromium.
// Starts disposable PGlite + API + static server; sends no SMS/WhatsApp.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createClient} from 'redis';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {embeddedStore} from '../helpers/embedded-store.js';
import {createApp} from '../../src/server.js';
import {RedisSecurity} from '../../src/redis-security.js';
import {MockVerify} from '../../src/otp-provider.js';

assert.ok(process.env.TEST_REDIS_URL,'TEST_REDIS_URL required');
const store=await embeddedStore();await store.migrate();
const client=createClient({url:process.env.TEST_REDIS_URL,socket:{connectTimeout:2000,reconnectStrategy:false}});client.on('error',()=>{});await client.connect();
const prefix='browser-test:'+randomUUID()+':';const security=new RedisSecurity(client,'browser-test-secret-with-at-least-32-chars',prefix);
const config={mode:'test',provider:'mock',countries:['US'],channels:['sms','whatsapp'],mockPhones:['+12025550123','+12025550124'],sendDailyLimit:1000,allowedOrigins:['http://127.0.0.1:5173'],tickMs:40};
const app=createApp({store,security,config,provider:new MockVerify({mode:'test',phones:config.mockPhones})});await app.ready;
await new Promise(r=>app.server.listen(3000,'127.0.0.1',r));
const webRoot=resolve('client/build/web');
const staticServer=createServer(async(req,res)=>{
 try{
  const path=resolve(webRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(path!==webRoot&&!path.startsWith(webRoot+sep)){res.writeHead(403).end();return;}
  const file=(await stat(path)).isDirectory()?resolve(path,'index.html'):path;
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.ttf':'font/ttf'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});await new Promise(r=>staticServer.listen(5173,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ca=await browser.newContext({viewport:{width:1440,height:1000}}),cb=await browser.newContext({viewport:{width:390,height:844}});
 const a=await ca.newPage(),b=await cb.newPage();
 const errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 for(const [i,p] of [a,b].entries()){
  await p.goto('http://127.0.0.1:5173');
  await p.getByRole('textbox',{name:'Numéro international'}).fill(config.mockPhones[i]);
  await p.getByRole('checkbox').check();
  await p.getByRole('button',{name:'Recevoir mon code',exact:true}).click();
  await p.getByRole('textbox',{name:'Code de vérification'}).fill('000000');
  await p.getByRole('button',{name:'Entrer dans le jeu',exact:true}).click();
  await p.getByRole('textbox',{name:'Votre pseudo',exact:true}).fill(i===0?'AliceFlutter':'BobFlutter');
  await p.getByRole('button',{name:'Enregistrer le pseudo',exact:true}).click();
 }
 await a.getByRole('button',{name:'Créer une salle',exact:true}).click();
 const {rows:[row]}=await store.pool.query('SELECT code FROM rooms');const code=row.code;
 await b.getByRole('textbox',{name:'Code de salle',exact:true}).fill(code);
 await b.getByRole('button',{name:'Rejoindre la partie',exact:true}).click();
 for(const p of [a,b])await p.getByRole('button',{name:'Je suis prêt',exact:true}).click();
 await a.getByRole('button',{name:'Lancer la partie',exact:true}).click();
 await mkdir('qa',{recursive:true});
 await a.screenshot({path:'qa/flutter-question-desktop.png',fullPage:true});
 await b.screenshot({path:'qa/flutter-question-mobile.png',fullPage:true});
 for(let round=0;round<3;round++){
  const {rows:[r]}=await store.pool.query('SELECT state FROM rooms WHERE code=$1',[code]);const q=r.state.questions[round];
  for(const [i,p]of [a,b].entries()){
   const choice=i===0?q.correctIndex:(q.correctIndex+1)%4;
   await p.getByRole('button',{name:new RegExp(`^${String.fromCharCode(65+choice)}\\s+${q.choices[choice].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)}).click();
  }
  if(round===0){
   await cb.setOffline(true);
   // Force an actual socket disconnect from the server while the client is offline.
   for(const ws of app.realtime.wss.clients)if(ws.user?.pseudo==='BobFlutter')ws.terminate();
   await cb.setOffline(false);
  }
  if(round<2)await a.getByRole('button',{name:'Question suivante',exact:true}).click({timeout:15000});
 }
 for(const p of [a,b])await p.getByText('Bien joué !',{exact:true}).waitFor({timeout:15000});
 await a.screenshot({path:'qa/flutter-results-desktop.png',fullPage:true});
 assert.equal((await store.pool.query('SELECT * FROM ledger')).rowCount,2);
 assert.deepEqual(errors,[]);
 console.log('PASS: Flutter Web, two browser contexts, OTP, lobby, three questions, reconnect, final rewards.');
}finally{
 if(browser)await browser.close();await new Promise(r=>staticServer.close(r));await app.close();
 const keys=await client.keys(prefix+'*');if(keys.length)await client.del(keys);await client.quit();await store.close();
}
