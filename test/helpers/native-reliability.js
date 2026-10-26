import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Competitions} from '../../src/competitions.js';
import {Realtime} from '../../src/realtime.js';

export async function nativeReliability(t,store) {
  const service=new Competitions(store);
  const {rows:users}=await store.pool.query('SELECT id FROM users ORDER BY id LIMIT 2');
  const ids=[randomUUID(),randomUUID()];
  for(const id of ids){
    await store.pool.query(`INSERT INTO competitions(id,title,starts_at,time_zone,silver_cost,minimum_players,categories,state,current_question,question_started_at,question_deadline)
      VALUES($1,'Native reliability',now(),'UTC',0,2,'[]','PHASE_1',0,clock_timestamp()-interval '1 second',clock_timestamp()+interval '60 seconds')`,[id]);
    for(const user of users)await store.pool.query('INSERT INTO competition_registrations(competition_id,user_id,paid_silver) VALUES($1,$2,0)',[id,user.id]);
  }
  await t.test('MVCC views do not wait for the exclusive competition transition lock',async()=>{
    const blocker=await store.pool.connect();let timer;
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM competitions WHERE id=$1 FOR UPDATE',[ids[0]]);
      const state=await Promise.race([service.play(users[0],ids[0]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('View waited on transition lock')),3000);})]);
      assert.equal(state.id,ids[0]);
      assert.ok(await service.receipt());
    }finally{clearTimeout(timer);await blocker.query('ROLLBACK');blocker.release();}
  });
  await t.test('one player registration lock does not block another player answer',async()=>{
    const blocker=await store.pool.connect();let timer;
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[ids[0]]);
      await blocker.query('SELECT user_id FROM competition_registrations WHERE competition_id=$1 AND user_id=$2 FOR UPDATE',[ids[0],users[0].id]);
      const answer=await Promise.race([service.play(users[1],ids[0],{questionNo:0,choice:0}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Answer serialized behind another player')),3000);})]);
      assert.equal(answer.accepted,true);
    }finally{clearTimeout(timer);await blocker.query('ROLLBACK');blocker.release();}
  });
  await t.test('a lower sequence committed later is delivered across competition streams',async()=>{
    const messages=[],client=await store.pool.connect();
    const peers=ids.map(id=>({competitionId:id,eventRevision:0,readyState:1,bufferedAmount:0,send:raw=>messages.push(JSON.parse(raw)),close(){}}));
    const realtime=Object.assign(Object.create(Realtime.prototype),{store:{pool:store.pool,authenticate:async()=>users[0]},wss:{clients:new Set(peers)},stopped:false});
    try{
      await client.query('BEGIN');
      const {rows:[early]}=await client.query("INSERT INTO competition_events(competition_id,revision,state) VALUES($1,2,'PHASE_1') RETURNING id::text",[ids[0]]);
      await store.pool.query("INSERT INTO competition_events(competition_id,revision,state) VALUES($1,2,'PHASE_1')",[ids[1]]);
      await realtime.competitionEvents();assert.equal(messages.length,1);
      await client.query('COMMIT');await realtime.competitionEvents();await realtime.competitionEvents();
      assert.equal(messages.length,2);assert.equal(messages[1].eventId,early.id);
    }finally{await client.query('ROLLBACK');client.release();}
  });
}
