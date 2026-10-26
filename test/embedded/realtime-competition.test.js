import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {embeddedStore} from '../helpers/embedded-store.js';
import {createApp} from '../../src/server.js';

test('real WebSockets on two API instances recover competition state and close presence',async()=>{
  const store=await embeddedStore(),apps=[],peers=[];
  const security={prefix:'embedded-ws:',async limit(){},client:{duplicate:()=>({isOpen:true,on(){},async connect(){},async subscribe(){},async quit(){this.isOpen=false;}})}};
  try{
    await store.migrate();
    const user=randomUUID(),id=randomUUID();
    await store.pool.query("INSERT INTO users(id,phone,pseudo,phone_verified_at) VALUES($1,'+12025550123','ReliablePeer',now())",[user]);
    const session=await store.transaction(c=>store.session(c,user));
    await store.pool.query(`INSERT INTO competitions(id,title,starts_at,time_zone,silver_cost,minimum_players,categories,state,current_question,question_started_at,question_deadline)
      VALUES($1,'WS reliability',now(),'UTC',0,2,'[]','PHASE_1',0,clock_timestamp(),clock_timestamp()+interval '60 seconds')`,[id]);
    await store.pool.query('INSERT INTO competition_registrations(competition_id,user_id,paid_silver) VALUES($1,$2,0)',[id,user]);
    const question=randomUUID(),content={text:'Network?',choices:['A','B','C','D'],correctIndex:0,explanation:'A'};
    await store.pool.query("INSERT INTO question_categories(slug,name) VALUES('network','Network')");
    await store.pool.query("INSERT INTO editorial_questions(id,category,language,difficulty,status,content) VALUES($1,'network','fr',1,'validated',$2)",[question,content]);
    await store.pool.query('INSERT INTO competition_questions(competition_id,position,question_id,version,snapshot) VALUES($1,0,$2,1,$3)',[id,question,{content,difficulty:1}]);
    async function start(){
      const app=createApp({store,security,provider:{real:true},config:{mode:'test',tickMs:60000}});
      apps.push(app);await app.ready;await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return app;
    }
    const first=await start(),second=await start();
    async function peer(app,afterRevision){
      const ws=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`),messages=[];
      peers.push(ws);ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
      const wait=async predicate=>{
        const end=Date.now()+5000;
        while(Date.now()<end){const found=messages.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,10));}
        throw new Error('WebSocket message timeout');
      };
      await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
      const send=data=>ws.send(JSON.stringify(data));
      send({type:'auth',accessToken:session.accessToken});await wait(m=>m.type==='authenticated');
      send({type:'competition.subscribe',id,afterRevision});await wait(m=>m.type==='competition.state');
      return {ws,messages,wait,send};
    }
    const a=await peer(first),b=await peer(second);
    a.send({type:'competition.answer',id,questionNo:0,choice:1,receivedAt:'2099-01-01'});
    assert.equal((await a.wait(m=>m.type==='competition.answer.accepted')).accepted,true);
    await second.realtime.repair();
    assert.equal((await b.wait(m=>m.type==='competition.state'&&m.state.myChoice===1)).state.personalRevision,1);
    // Simulate a lost event notification. Repair still recovers committed revision.
    await store.transaction(c=>first.competitions.engine.event(c,id));
    await second.realtime.repair();
    await b.wait(m=>m.type==='competition.state'&&m.state.revision===2);
    await new Promise(resolve=>{a.ws.once('close',resolve);a.ws.close();});
    await first.close();apps.splice(apps.indexOf(first),1);
    assert.equal((await store.pool.query('SELECT id FROM competition_connections WHERE competition_id=$1 AND disconnected_at IS NOT NULL',[id])).rowCount,1);
    const restarted=await start(),resumed=await peer(restarted,1);
    assert.equal((await resumed.wait(m=>m.type==='competition.state')).state.myChoice,1);
    await restarted.realtime.competitionEvents();
    assert.equal((await resumed.wait(m=>m.type==='competition.updated')).revision,2);
    await restarted.realtime.competitionEvents();
    assert.equal(resumed.messages.filter(m=>m.type==='competition.updated').length,1);
  }finally{
    for(const ws of peers)ws.terminate();
    for(const app of apps)await app.close();
    await store.close();
  }
});
