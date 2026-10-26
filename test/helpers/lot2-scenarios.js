import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {catalogFixture} from './catalog-fixture.js';
import {PersistentCatalog} from '../../src/persistent-catalog.js';
import {DurableRooms} from '../../src/durable-rooms.js';
import {People} from '../../src/people.js';
import {Economy} from '../../src/economy.js';
import {Editorial} from '../../src/editorial.js';

export async function lot2Scenarios(t,store){
  await store.migrate();await catalogFixture(store);
  const rooms=new DurableRooms(store),people=new People(store),economy=new Economy(store),editorial=new Editorial(store),catalog=new PersistentCatalog(store);
  const users=[];
  for(let i=0;i<3;i++){
    const id=randomUUID();users.push({id,pseudo:'Lot2_'+id.replaceAll('-','').slice(0,12)});
    await store.pool.query('INSERT INTO users(id,phone,pseudo,phone_verified_at) VALUES($1,$2,$3,now())',[id,'+1505'+String(Math.floor(Math.random()*1e7)).padStart(7,'0'),users[i].pseudo]);
    await store.pool.query('INSERT INTO wallet_accounts(user_id) VALUES($1)',[id]);
  }
  const [admin,a,b]=users;
  await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator'),($2,'moderator')",[admin.id,b.id]);
  let code,questionId;
  async function finish(code){
    const {rows:[row]}=await store.pool.query('SELECT state FROM rooms WHERE code=$1',[code]);
    row.state.startedAt=0;await store.pool.query('UPDATE rooms SET state=$2 WHERE code=$1',[code,row.state]);
    await rooms.settle(code);
  }
  await t.test('shared persistent selection excludes development, balances categories and validates image media',async()=>{
    for(const category of ['lot2_a','lot2_b']){
      await editorial.category(admin,{slug:category,name:category});
      for(let i=0;i<3;i++)await editorial.save(admin,{category,language:'fr',difficulty:1,status:'validated',text:`${category} ${i}`,choices:['A','B','C','D'],correctIndex:0,explanation:'A',source:'Fixture',media:{type:'image',url:'https://example.org/image.png',alt:'Illustration'}});
    }
    const selected=await store.transaction(c=>catalog.select(c,{categories:['lot2_a','lot2_b'],count:4}));
    assert.equal(selected.filter(q=>q.category==='lot2_a').length,2);
    await editorial.category(admin,{slug:'only_dev',name:'Only dev'});
    await editorial.save(admin,{category:'only_dev',language:'fr',difficulty:1,status:'validated',development:true,text:'Development only',choices:['A','B','C','D'],correctIndex:0,explanation:'A',source:'Fixture'});
    await assert.rejects(rooms.create(a,{categories:['only_dev'],questionCount:1}),{status:409});
    await assert.rejects(editorial.save(admin,{...selected[0],...selected[0].content,media:{type:'image',url:'javascript:alert(1)',alt:'Bad'}}),{status:400});
    assert.equal((await editorial.list(admin,{limit:1})).nextOffset,1);
  });
  await t.test('rooms enforce host, kicks and frozen questions; solo and duel use same catalogue',async()=>{
    const room=await rooms.create(a,{name:'Lot 2 room',visibility:'public',categories:['fixture'],questionCount:1,durationMs:1000});code=room.code;
    await rooms.execute(b,code,'join');await assert.rejects(rooms.execute(b,code,'kick',{userId:a.id}),{status:403});
    await rooms.execute(a,code,'kick',{userId:b.id});await assert.rejects(rooms.execute(b,code,'join'),{status:403});
    await rooms.execute(admin,code,'join');await rooms.execute(a,code,'host',{userId:admin.id});
    for(const user of [a,admin])await rooms.execute(user,code,'ready',{ready:true});
    const start=await rooms.execute(admin,code,'start');questionId=start.question.id;
    assert.equal(start.question.correctIndex,undefined);assert.equal(start.correctIndex,undefined);
    await store.pool.query("UPDATE editorial_questions SET content=jsonb_set(content,'{correctIndex}','3') WHERE id=$1",[questionId]);
    await rooms.execute(a,code,'answers',{questionId,choice:0});await rooms.execute(admin,code,'answers',{questionId,choice:0});
    await finish(code);
    assert.equal((await rooms.snapshot(a,code)).correctIndex,0);
    assert.equal((await rooms.history(a,{limit:1})).items.length,1);
    const rematch=await rooms.rematch(admin,code);assert.equal((await rooms.rematch(admin,code)).code,rematch.code);
    const solo=await rooms.create(a,{mode:'solo',categories:['fixture'],questionCount:1,durationMs:1000});
    assert.equal(solo.status,'question');assert.notEqual(solo.question.id,questionId);
    await rooms.execute(a,solo.code,'answers',{questionId:solo.question.id,choice:0});await finish(solo.code);
    const duel=await rooms.create(a,{mode:'duel',categories:['fixture'],questionCount:1});
    await rooms.execute(b,duel.code,'join');await assert.rejects(rooms.execute(admin,duel.code,'join'),{status:409});
    const publicRooms=await rooms.list(a);assert.ok(publicRooms.items.every(r=>r.code!==duel.code));
  });
  await t.test('profiles, friends and invitations enforce owner and recipient permissions',async()=>{
    const profile=await people.profile(a,{pseudo:a.pseudo,avatar:'fox',country:'TN',languages:['fr','ar'],birthDate:'1990-01-01'});
    assert.equal(profile.avatar,'fox');assert.equal(profile.gifts.eligible,false);assert.ok(profile.badges.includes('first_game'));
    await people.friend(a,{action:'request',pseudo:b.pseudo});
    await assert.rejects(people.friend(admin,{action:'accept',userId:a.id}),{status:404});
    await people.friend(b,{action:'accept',userId:a.id});
    const lobby=await rooms.create(a,{categories:['fixture'],questionCount:1});
    await people.invite(a,{code:lobby.code,userId:b.id});await people.invite(a,{code:lobby.code,userId:b.id});
    assert.equal((await people.invitations(b)).items.length,1);
    assert.equal((await people.invitations(admin)).items.length,0);
    assert.equal((await people.friends(a)).items[0].status,'accepted');
  });
  await t.test('daily bonus is atomic, shares server cap and reconciliation repairs cache without ledger mutation',async()=>{
    await assert.rejects(economy.settings(b,{daily_bonus:1000}),{status:403});
    await economy.settings(admin,{daily_bonus:5,daily_silver_cap:100});
    const before=(await store.wallet(a.id)).silver;
    const results=await Promise.all(Array.from({length:8},()=>economy.bonus(a)));
    assert.ok(results.every(r=>r.amount===5));assert.equal((await store.wallet(a.id)).silver,before+5);
    assert.equal((await store.wallet(a.id,{limit:1})).entries.length,1);
    const ledgerCount=(await store.pool.query('SELECT id FROM ledger')).rowCount;
    await store.pool.query('UPDATE wallet_accounts SET silver_balance=silver_balance+7 WHERE user_id=$1',[a.id]);
    assert.equal((await economy.reconcile()).mismatches,1);
    assert.equal((await economy.reconcile({repair:true})).mismatches,1);
    assert.equal((await store.wallet(a.id)).silver,before+5);
    assert.equal((await store.pool.query('SELECT id FROM ledger')).rowCount,ledgerCount);
    await economy.settings(admin,{daily_silver_cap:before+5});
    const entry=await store.transaction(c=>store.post(c,{userId:a.id,amount:1,reason:'room_reward',refId:randomUUID(),key:randomUUID()}));assert.equal(entry.amount,0);
  });
  await t.test('export contains own data but no secrets; deletion revokes sessions and preserves immutable ledger',async()=>{
    await store.transaction(c=>store.post(c,{userId:b.id,amount:1,reason:'test_funding',refId:b.id,key:randomUUID()}));
    const session=await store.transaction(c=>store.session(c,b.id));
    const exported=await people.export(b);assert.equal(exported.profile[0].id,b.id);assert.equal(JSON.stringify(exported).includes('refresh_hash'),false);
    await assert.rejects(people.remove(b,{confirm:'no'}),{status:400});
    const deleted=await people.remove(b,{confirm:'DELETE'});assert.equal(deleted.deleted,true);
    await assert.rejects(store.authenticate(session.accessToken),{status:401});
    await assert.rejects(store.refresh(session.refreshToken),{status:401});
    const {rows:[tombstone]}=await store.pool.query('SELECT phone,birth_date,pseudo FROM users WHERE id=$1',[b.id]);
    assert.equal(tombstone.phone,null);assert.equal(tombstone.birth_date,null);assert.match(tombstone.pseudo,/^Deleted_/);
    assert.equal((await people.friends(a)).items.length,0);
    assert.equal((await store.pool.query('SELECT id FROM ledger WHERE user_id=$1',[b.id])).rowCount,1);
  });
}
