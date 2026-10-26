import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Competitions} from '../../src/competitions.js';
import {Editorial} from '../../src/editorial.js';
import {seedCommitment} from '../../src/competition-rules.js';

export async function engineScenarios(t,store) {
  await store.migrate();
  const service=new Competitions(store),editorial=new Editorial(store),users=[];
  for(let i=0;i<3;i++){
    const id=randomUUID();users.push({id});
    await store.pool.query('INSERT INTO users(id,phone,pseudo) VALUES($1,$2,$3)',[id,`+1303${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`,`engine_${id}`]);
    await store.pool.query('INSERT INTO wallet_accounts(user_id) VALUES($1)',[id]);
  }
  const [admin,a,b]=users;
  await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator')",[admin.id]);
  await editorial.category(admin,{slug:'engine',name:'Engine fixtures'});
  for(let i=0;i<2;i++)await editorial.save(admin,{category:'engine',language:'fr',difficulty:1,status:'validated',text:`Question ${i}`,choices:['A','B','C','D'],correctIndex:0,explanation:'A est correcte.',source:'Fixture'});
  async function create(limit=2) {
    const row=await service.create(admin,{title:'Engine test',startsAt:new Date(Date.now()+3600000).toISOString(),timeZone:'UTC',silverCost:0,minimumPlayers:2,categories:['engine'],questionLimit:limit,repetitionDays:0});
    await service.open(admin,row.id);await service.register(a,row.id);await service.register(b,row.id);
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[row.id]);
    await service.reconcile();return row.id;
  }
  async function transition(id) {
    await store.pool.query("UPDATE competitions SET next_transition_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    await new Competitions(store).reconcile();
  }
  async function close(id) {
    await store.pool.query("UPDATE competitions SET question_deadline=clock_timestamp()-interval '25 seconds' WHERE id=$1",[id]);
    await Promise.all([service.reconcile(),new Competitions(store).reconcile()]);
  }
  await t.test('persistent questions, deduplication, unauthorized and late answers, no corrections before close',async()=>{
    const id=await create();
    const before=await service.play(a,id);
    assert.equal(before.correction,undefined);assert.equal(before.tieSeed,undefined);
    await assert.rejects(service.play(admin,id,{questionNo:0,choice:0}),{status:403});
    const results=await Promise.all([service.play(a,id,{questionNo:0,choice:0}),service.play(a,id,{questionNo:0,choice:0})]);
    assert.ok(results.every(x=>x.accepted));
    await assert.rejects(service.play(a,id,{questionNo:0,choice:1}),{status:409});
    assert.equal((await service.play(a,id)).correction,undefined);
    await close(id);
    await assert.rejects(service.play(b,id,{questionNo:0,choice:0}),{status:409});
    assert.equal((await service.play(a,id)).correction.correctIndex,0);
    assert.equal((await service.play(b,id)).me.eliminated,true);
    await transition(id);
    assert.equal((await service.play(a,id)).state,'PHASE_2');
    await transition(id);
    const finished=await service.play(a,id);
    assert.equal(finished.state,'TERMINEE');assert.equal(finished.me.rank,1);
    assert.equal(seedCommitment(finished.tieSeed),finished.tieCommitment);
    await service.reconcile();assert.equal((await store.wallet(a.id)).golden,6);
  });
  await t.test('all wrong replays; strict small group reaches ceiling, milestone then finale; rewards atomic after crash',async()=>{
    const id=await create();
    await service.play(a,id,{questionNo:0,choice:1});await service.play(b,id,{questionNo:0,choice:1});
    await close(id);assert.equal((await service.play(a,id)).survivors,2);
    await transition(id);
    assert.equal((await service.play(a,id)).questionNo,1);
    await service.play(a,id,{questionNo:1,choice:0});await service.play(b,id,{questionNo:1,choice:0});
    // Inject a failure before reward persistence to verify transaction rollback.
    const original=store.post;store.post=async()=>{throw new Error('injected reward crash');};
    await store.pool.query("UPDATE competitions SET question_deadline=clock_timestamp()-interval '25 seconds' WHERE id=$1",[id]);
    try {await assert.rejects(service.reconcile(),/injected reward crash/);}finally{store.post=original;}
    assert.equal((await service.play(a,id)).correction,undefined);
    await new Competitions(store).reconcile();
    const palier=await service.play(a,id);assert.equal(palier.state,'PALIER_ATTEINT');assert.equal(palier.survivors,1);
    await transition(id);assert.equal((await service.play(a,id)).state,'PHASE_2');
    await transition(id);
    const end=await service.play(a,id);assert.equal(end.state,'TERMINEE');
    const {rows}=await store.pool.query("SELECT reason,count(*)::int AS n FROM ledger WHERE ref_id=$1 GROUP BY reason",[id]);
    assert.equal(rows.find(x=>x.reason==='competition_milestone').n,1);
    assert.equal(rows.find(x=>x.reason==='competition_winner').n,1);
    assert.ok((await service.leaderboard('all')).ranking.length>0);
  });
  await t.test('24 second grace delays correction without accepting late responses',async()=>{
    const id=await create(1);
    await store.pool.query("UPDATE competitions SET question_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    await service.reconcile();
    assert.equal((await service.play(a,id)).correction,undefined);
    await assert.rejects(service.play(a,id,{questionNo:0,choice:0}),{status:409});
    await close(id);
    assert.equal((await service.play(a,id)).state,'PALIER_ATTEINT');
  });
  await t.test('forty real registrations play phase one, milestone and a separate final question',async()=>{
    const roster=[a,b];
    for(let i=2;i<40;i++){
      const id=randomUUID();roster.push({id});
      await store.pool.query('INSERT INTO users(id,phone,pseudo) VALUES($1,$2,$3)',[id,`+1404${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`,`final_${id}`]);
      await store.pool.query('INSERT INTO wallet_accounts(user_id) VALUES($1)',[id]);
    }
    const event=await service.create(admin,{title:'Two phases',startsAt:new Date(Date.now()+3600000).toISOString(),timeZone:'UTC',silverCost:0,minimumPlayers:40,categories:['engine'],questionLimit:2,repetitionDays:0});
    await service.open(admin,event.id);
    for(const p of roster)await service.register(p,event.id);
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[event.id]);
    await service.reconcile();
    for(const [index,p] of roster.entries())await service.play(p,event.id,{questionNo:0,choice:index<2?0:1});
    await close(event.id);
    assert.equal((await service.play(a,event.id)).state,'PALIER_ATTEINT');
    assert.equal((await service.play(a,event.id)).survivors,2);
    await transition(event.id);await transition(event.id);
    assert.equal((await service.play(a,event.id)).questionNo,1);
    await service.play(a,event.id,{questionNo:1,choice:0});await service.play(b,event.id,{questionNo:1,choice:1});
    await close(event.id);await transition(event.id);
    const finished=await service.play(a,event.id);assert.equal(finished.state,'TERMINEE');assert.equal(finished.me.rank,1);
    const {rows}=await store.pool.query("SELECT reason,count(*)::int AS n FROM ledger WHERE ref_id=$1 GROUP BY reason",[event.id]);
    assert.equal(rows.find(x=>x.reason==='competition_milestone').n,2);
    assert.equal(rows.find(x=>x.reason==='competition_winner').n,1);
    const stats=await editorial.statistics(admin);assert.ok(stats.statistics.some(q=>q.answers>=40));
  });
}
