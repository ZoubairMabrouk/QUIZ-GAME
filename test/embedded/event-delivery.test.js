import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embeddedStore} from '../helpers/embedded-store.js';
import {Realtime} from '../../src/realtime.js';

test('per-competition delivery repairs late lower sequence IDs, duplicates and instance restart',async()=>{
  const store=await embeddedStore();
  try{
    await store.migrate();
    const a=randomUUID(),b=randomUUID();
    for(const id of [a,b])await store.pool.query("INSERT INTO competitions(id,title,starts_at,time_zone,silver_cost,minimum_players,categories) VALUES($1,'Delivery',now(),'UTC',0,2,'[]')",[id]);
    const messages=[];
    const sockets=[a,b].map(id=>({competitionId:id,eventRevision:0,readyState:1,bufferedAmount:0,send:raw=>messages.push(JSON.parse(raw)),close(){}}));
    const realtime=Object.assign(Object.create(Realtime.prototype),{store,wss:{clients:new Set(sockets)},stopped:false});
    const authenticate=store.authenticate;store.authenticate=async()=>({id:'test'});
    await store.pool.query("INSERT INTO competition_events(id,competition_id,revision,state) VALUES(200,$1,2,'PHASE_1')",[a]);
    await realtime.competitionEvents();
    // Models transaction A reserving 199, B committing 200, then A committing 199.
    await store.pool.query("INSERT INTO competition_events(id,competition_id,revision,state) VALUES(199,$1,2,'PHASE_1')",[b]);
    await realtime.competitionEvents();await realtime.competitionEvents();
    assert.deepEqual(messages.map(m=>m.eventId),['200','199']);
    const restarted=Object.assign(Object.create(Realtime.prototype),{store,wss:{clients:new Set([{...sockets[1],eventRevision:0}])},stopped:false});
    await restarted.competitionEvents();
    assert.equal(messages.at(-1).eventId,'199');
    assert.equal(messages.filter(m=>m.id===a).length,1);
    store.authenticate=authenticate;
  }finally{await store.close();}
});
