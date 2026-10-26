import {catalogFixture} from './catalog-fixture.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from 'redis';
import WebSocket from 'ws';
import {RedisSecurity} from '../../src/redis-security.js';
import {MockVerify} from '../../src/otp-provider.js';
import {createApp} from '../../src/server.js';
import {Editorial} from '../../src/editorial.js';

class Peer {
  constructor(url,origin='http://localhost:5173'){
    this.socket=new WebSocket(url,{origin});this.messages=[];this.waiters=[];
    this.open=new Promise((resolve,reject)=>{this.socket.once('open',resolve);this.socket.once('error',reject);});
    this.socket.on('message',raw=>{const m=JSON.parse(raw.toString());this.messages.push(m);for(const w of [...this.waiters])if(w.predicate(m)){this.waiters.splice(this.waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve(m);}});
  }
  send(message){this.socket.send(JSON.stringify(message));}
  wait(predicate,timeout=5000){const found=this.messages.find(predicate);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const w={predicate,resolve};w.timer=setTimeout(()=>{this.waiters=this.waiters.filter(x=>x!==w);reject(new Error('WebSocket event timeout'));},timeout);this.waiters.push(w);});}
  async login(token,code){await this.open;this.send({type:'auth',accessToken:token});await this.wait(m=>m.type==='authenticated');this.send({type:'subscribe',code});return this.wait(m=>m.type==='room.state');}
  async close(){if(this.socket.readyState===WebSocket.CLOSED)return;await new Promise(r=>{this.socket.once('close',r);this.socket.close();});}
}
export async function realtimeScenarios(t,store){
  assert.ok(process.env.TEST_REDIS_URL,'TEST_REDIS_URL required');
  await store.migrate();
  await catalogFixture(store);
  const client=createClient({url:process.env.TEST_REDIS_URL,socket:{connectTimeout:2000,reconnectStrategy:false}});client.on('error',()=>{});await client.connect();
  const prefix='ws-test:'+randomUUID()+':';const security=new RedisSecurity(client,'test-secret-for-realtime-integration',prefix);
  const config={mode:'test',provider:'mock',countries:['US'],channels:['sms','whatsapp'],mockPhones:['+12025550123','+12025550124'],sendDailyLimit:1000,tickMs:40,allowedOrigins:['http://localhost:5173']};
  const provider=new MockVerify({mode:'test',phones:config.mockPhones});
  const apps=[createApp({store,security,provider,config}),createApp({store,security,provider,config})];
  const peers=[];
  try{
    for(const app of apps){await app.ready;await new Promise(r=>app.server.listen(0,'127.0.0.1',r));}
    const base=apps.map(a=>`http://127.0.0.1:${a.server.address().port}`);
    async function api(index,path,body,token){const response=await fetch(base[index]+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
    const logins=[];
    for(let i=0;i<2;i++){
      const challenge=await api(i,'/auth/otp/request',{phone:config.mockPhones[i],channel:'sms',consent:true});
      const session=await api(i,'/auth/otp/verify',{challengeId:challenge.challengeId,code:'000000'});
      await api(i,'/me/profile',{pseudo:i===0?'AliceLive':'BobLive'},session.accessToken);logins.push(session);
    }
    const room=await api(0,'/rooms',{questionCount:2,durationMs:1000},logins[0].accessToken);const root='/rooms/'+room.code;
    await api(1,root+'/join',{},logins[1].accessToken);
    const a=new Peer(base[0].replace('http','ws')+'/ws'),b=new Peer(base[1].replace('http','ws')+'/ws');peers.push(a,b);
    await a.login(logins[0].accessToken,room.code);await b.login(logins[1].accessToken,room.code);
    await t.test('two API instances receive lobby updates via Redis',async()=>{
      await api(0,root+'/ready',{ready:true},logins[0].accessToken);await api(1,root+'/ready',{ready:true},logins[1].accessToken);
      for(const p of [a,b]){const event=await p.wait(m=>m.type==='room.state'&&m.state.players.every(x=>x.ready));assert.equal(event.state.players.length,2);}
    });
    await t.test('same question is pushed, corrections hidden and own answer restored after reconnect',async()=>{
      await api(0,root+'/start',{},logins[0].accessToken);
      const [qa,qb]=await Promise.all([a.wait(m=>m.state?.status==='question'),b.wait(m=>m.state?.status==='question')]);
      assert.equal(qa.state.question.id,qb.state.question.id);assert.equal(qa.state.correctIndex,undefined);assert.equal(qa.state.question.correctIndex,undefined);
      const {rows:[r]}=await store.pool.query('SELECT state FROM rooms WHERE code=$1',[room.code]);const answer=r.state.questions[0].correctIndex;
      await api(0,root+'/answers',{questionId:qa.state.question.id,choice:answer},logins[0].accessToken);
      await api(1,root+'/answers',{questionId:qa.state.question.id,choice:(answer+1)%4},logins[1].accessToken);
      await b.close();const reconnect=new Peer(base[1].replace('http','ws')+'/ws');peers.push(reconnect);
      const resumed=await reconnect.login(logins[1].accessToken,room.code);assert.equal(resumed.state.answered,true);assert.equal(resumed.state.selectedChoice,(answer+1)%4);
      for(const p of [a,reconnect]){
        const result=await p.wait(m=>m.state?.status==='results');assert.equal(result.state.correctIndex,answer);
        assert.ok(p.messages.filter(m=>m.state?.status==='question').every(m=>m.state.correctIndex===undefined && m.state.question.correctIndex===undefined));
      }
    });
    await t.test('deadline settles without client polling and final rewards are unique',async()=>{
      await api(0,root+'/next',{},logins[0].accessToken);
      const final=await a.wait(m=>m.state?.status==='finished');assert.equal(final.state.ranking[0].id,logins[0].user.id);
      assert.equal(final.state.rewards.length,2);assert.equal((await store.wallet(logins[0].user.id)).silver,20);
      assert.equal((await store.wallet(logins[1].user.id)).silver,12);
      await Promise.all([apps[0].realtime.sweep(),apps[1].realtime.sweep()]);
      assert.equal((await store.pool.query('SELECT * FROM ledger')).rowCount,2);
    });
    await t.test('CORS and WebSocket reject unapproved browser origins',async()=>{
      const yes=await fetch(base[0]+'/rooms',{method:'OPTIONS',headers:{origin:'http://localhost:5173','access-control-request-method':'POST'}});assert.equal(yes.status,204);
      const no=await fetch(base[0]+'/rooms',{method:'OPTIONS',headers:{origin:'https://evil.example'}});assert.equal(no.status,403);
      const rejected=new Peer(base[0].replace('http','ws')+'/ws','https://evil.example');await assert.rejects(rejected.open,/403/);
    });
    await t.test('competition on two instances shares answers, durable events and reconnects without leaking corrections',async()=>{
      const userA=logins[0].user,userB=logins[1].user;
      await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator')",[userA.id]);
      const editorial=new Editorial(store);
      await editorial.category(userA,{slug:'live',name:'Live fixtures'});
      await editorial.save(userA,{category:'live',language:'fr',difficulty:1,status:'validated',text:'Live ?',choices:['A','B','C','D'],correctIndex:0,explanation:'A',source:'Fixture'});
      const event=await api(0,'/v1/admin/competitions',{title:'Live event',startsAt:new Date(Date.now()+3600000).toISOString(),timeZone:'UTC',silverCost:0,minimumPlayers:2,categories:['live'],questionLimit:1,repetitionDays:0},logins[0].accessToken);
      await api(0,`/v1/admin/competitions/${event.id}/open`,{},logins[0].accessToken);
      for(let i=0;i<2;i++)await api(i,`/v1/competitions/${event.id}/register`,{},logins[i].accessToken);
      await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[event.id]);
      await apps[0].competitions.reconcile();
      const live=[];
      for(let i=0;i<2;i++){
        const p=new Peer(base[i].replace('http','ws')+'/ws');peers.push(p);live.push(p);await p.open;
        p.send({type:'auth',accessToken:logins[i].accessToken});await p.wait(m=>m.type==='authenticated');
        p.send({type:'competition.subscribe',id:event.id});const initial=await p.wait(m=>m.type==='competition.state');
        assert.equal(initial.state.correction,undefined);
      }
      live[0].send({type:'competition.answer',id:event.id,questionNo:0,choice:0});
      await live[0].wait(m=>m.type==='competition.answer.accepted');
      await api(1,`/v1/competitions/${event.id}/answers`,{questionNo:0,choice:0},logins[0].accessToken);
      await api(1,`/v1/competitions/${event.id}/answers`,{questionNo:0,choice:1},logins[1].accessToken);
      await store.pool.query("UPDATE competitions SET question_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[event.id]);
      await Promise.all(apps.map(app=>app.competitions.reconcile()));
      await Promise.all(apps.map(app=>app.realtime.competitionEvents()));
      for(const p of live)assert.equal((await p.wait(m=>m.type==='competition.updated' && m.state==='PALIER_ATTEINT')).state,'PALIER_ATTEINT');
      const restored=await api(1,`/v1/competitions/${event.id}/play`,undefined,logins[0].accessToken);
      assert.equal(restored.myChoice,0);assert.equal(restored.correction.correctIndex,0);
      assert.equal((await api(0,`/v1/competitions/${event.id}/play`,undefined,logins[1].accessToken)).me.eliminated,true);
    });
    await t.test('unknown member denied; revoked socket cannot receive private state',async()=>{
      const outsider=await store.completeLogin({challengeId:randomUUID(),phone:'+12025550199',verified:false});
      const p=new Peer(base[0].replace('http','ws')+'/ws');peers.push(p);await p.open;p.send({type:'auth',accessToken:outsider.accessToken});await p.wait(m=>m.type==='authenticated');p.send({type:'subscribe',code:room.code});
      const e=await p.wait(m=>m.type==='error');assert.equal(e.status,403);assert.equal(p.messages.some(m=>m.type==='room.state'),false);
      await api(0,'/auth/logout',{},logins[0].accessToken);a.send({type:'ping',clientTime:1});assert.equal((await a.wait(m=>m.type==='error')).status,401);
    });
  }finally{
    await Promise.all(peers.map(p=>p.close()));for(const app of apps)await app.close();
    const keys=await client.keys(prefix+'*');if(keys.length)await client.del(keys);await client.quit();
  }
}
