import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Competitions} from '../../src/competitions.js';
import {Editorial} from '../../src/editorial.js';

export async function competitionScenarios(t,store) {
  await store.migrate();
  const service = new Competitions(store);
  const users=[];
  for (let i=0;i<3;i++) {
    const id=randomUUID(); users.push({id});
    await store.pool.query('INSERT INTO users(id,phone,pseudo) VALUES($1,$2,$3)',[id,`+1202${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`,`test_${id}`]);
    await store.pool.query('INSERT INTO wallet_accounts(user_id) VALUES($1)',[id]);
  }
  const [admin,a,b]=users;
  await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator'),($2,'moderator')",[admin.id,b.id]);
  const editorial=new Editorial(store);
  await editorial.category(admin,{slug:'science',name:'Science'});
  const question={category:'science',language:'fr',difficulty:1,status:'validated',development:false,text:'Question test ?',choices:['A','B','C','D'],correctIndex:0,explanation:'Explication test.',source:'Fixture de test'};
  const first=await editorial.save(admin,question);
  await store.transaction(c=>store.post(c,{userId:a.id,amount:100,reason:'test_funding',refId:a.id,key:a.id}));
  const input={title:'Test compétition',startsAt:new Date(Date.now()+3600000).toISOString(),timeZone:'Africa/Lagos',silverCost:25,minimumPlayers:2,categories:['science'],questionLimit:1,repetitionDays:0};
  let event;
  await t.test('server roles and schedule validation',async()=>{
    await assert.rejects(service.create(a,input),{status:403});
    await assert.rejects(service.create(b,input),{status:403});
    await assert.rejects(service.create(admin,{...input,timeZone:'unknown'}),{status:400});
    await assert.rejects(service.create(admin,{...input,gifts:true}),{status:409});
    event=await service.create(admin,input);
    await service.open(admin,event.id);
  });
  await t.test('editorial validation, import all-or-nothing, moderator access and version conflict',async()=>{
    await assert.rejects(editorial.list(a),{status:403});
    assert.equal((await editorial.list(b)).questions.length,1);
    const report=await editorial.import(b,{questions:[question,{...question,choices:['A']}]});
    assert.equal(report.imported,0);assert.equal(report.errors[0].row,2);
    assert.equal((await editorial.list(b)).questions.length,1);
    await assert.rejects(editorial.save(b,{...question,version:0},first.id),{status:409});
  });
  await t.test('concurrent retries debit once and insufficient balance rolls back',async()=>{
    const results=await Promise.all(Array.from({length:6},()=>service.register(a,event.id)));
    assert.ok(results.every(r=>r.user_id===a.id));
    assert.equal((await store.wallet(a.id)).silver,75);
    await assert.rejects(service.register(b,event.id),{status:409});
    assert.equal((await service.list(b,event.id)).participants,1);
    assert.equal((await service.list(b,event.id)).registered_at,null);
  });
  await t.test('late registration rejected using database clock; automatic refund exactly once',async()=>{
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()+interval '5 minutes' WHERE id=$1",[event.id]);
    await assert.rejects(service.register(b,event.id),{status:409});
    await Promise.all([service.reconcile(),service.reconcile()]);
    await service.cancel(admin,event.id);
    assert.equal((await service.list(a,event.id)).state,'ANNULEE');
    assert.equal((await store.wallet(a.id)).silver,100);
    const {rows:[count]}=await store.pool.query("SELECT count(*)::int AS n FROM ledger WHERE ref_id=$1 AND reason='competition_refund'",[event.id]);
    assert.equal(count.n,1);
    assert.ok((await service.register(a,event.id)).refunded_at);
  });
  await t.test('refund failure rolls back cancellation and can resume after restart',async()=>{
    const next=await service.create(admin,input); await service.open(admin,next.id); await service.register(a,next.id);
    const original=store.post;
    store.post=async()=>{throw new Error('simulated crash');};
    try {await assert.rejects(service.cancel(admin,next.id),/simulated crash/);} finally {store.post=original;}
    assert.equal((await service.list(a,next.id)).state,'INSCRIPTIONS_OUVERTES');
    assert.equal((await store.wallet(a.id)).silver,75);
    await new Competitions(store).cancel(admin,next.id);
    assert.equal((await store.wallet(a.id)).silver,100);
  });
  await t.test('minimum reached closes registration and starts persistent gameplay',async()=>{
    const next=await service.create(admin,{...input,silverCost:0});await service.open(admin,next.id);
    await Promise.all([service.register(a,next.id),service.register(b,next.id)]);
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()+interval '4 minutes' WHERE id=$1",[next.id]);
    await service.reconcile();assert.equal((await service.list(a,next.id)).state,'INSCRIPTIONS_CLOSES');
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[next.id]);
    await new Competitions(store).reconcile();
    assert.equal((await service.list(a,next.id)).state,'PHASE_1');
    assert.equal((await service.list(a,next.id)).tie_seed,undefined);
    assert.equal((await service.play(a,next.id)).questionNo,0);
    await assert.rejects(service.play(admin,next.id),{status:403});
  });
  await t.test('T-10 freeze keeps historical question despite editorial update and withdrawal',async()=>{
    const next=await service.create(admin,input);await service.open(admin,next.id);
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()+interval '9 minutes' WHERE id=$1",[next.id]);
    await service.reconcile();
    const {rows:[frozen]}=await store.pool.query('SELECT * FROM competition_questions WHERE competition_id=$1',[next.id]);
    assert.equal(frozen.snapshot.content.correctIndex,0);
    await editorial.save(b,{...question,version:1,correctIndex:3,status:'retired'},first.id);
    await service.reconcile();
    const {rows:[unchanged]}=await store.pool.query('SELECT * FROM competition_questions WHERE competition_id=$1',[next.id]);
    assert.equal(unchanged.snapshot.content.correctIndex,0);
    assert.equal((await editorial.history(b,first.id)).versions.length,2);
    assert.equal(JSON.stringify(await service.list(a,next.id)).includes('correctIndex'),false);
    await assert.rejects(store.pool.query('DELETE FROM competition_questions WHERE competition_id=$1',[next.id]),/Immutable ledger/);
    const noBank=await service.create(admin,input);
    await store.pool.query("UPDATE competitions SET starts_at=clock_timestamp()+interval '9 minutes' WHERE id=$1",[noBank.id]);
    await service.reconcile();
    assert.equal((await service.list(a,noBank.id)).cancellation_reason,'insufficient_catalog');
  });
}
