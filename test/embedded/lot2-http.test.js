import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embeddedStore} from '../helpers/embedded-store.js';
import {catalogFixture} from '../helpers/catalog-fixture.js';
import {createApp} from '../../src/server.js';
test('Lot 2 real HTTP: persistent solo, QR invitation, profile, wallet and import body limit',async()=>{
  const store=await embeddedStore();let app;
  try{
    await store.migrate();await catalogFixture(store);
    const id=randomUUID();
    await store.pool.query("INSERT INTO users(id,phone,pseudo,phone_verified_at) VALUES($1,'+12025550123','Lot2HTTP',now())",[id]);
    await store.pool.query('INSERT INTO wallet_accounts(user_id) VALUES($1)',[id]);
    await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator')",[id]);
    const session=await store.transaction(c=>store.session(c,id));
    const security={prefix:'lot2-http:',async limit(){},client:{duplicate:()=>({isOpen:true,on(){},async connect(){},async subscribe(){},async quit(){this.isOpen=false;}})}};
    app=createApp({store,security,provider:{real:true},config:{mode:'production',tickMs:60000,playerPublicUrl:'https://quiz.example.org'}});
    await app.ready;await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const request=async(path,body)=>{
      const response=await fetch(`http://127.0.0.1:${app.server.address().port}`+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+session.accessToken},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json()};
    };
    const solo=await request('/solo',{categories:['fixture'],questionCount:1});assert.equal(solo.status,201);assert.equal(solo.data.status,'question');assert.equal(solo.data.question.correctIndex,undefined);
    const share=await request(`/rooms/${solo.data.code}/share`);assert.equal(share.status,200);
    assert.equal(share.data.link,`https://quiz.example.org/#/join/${solo.data.code}`);
    assert.ok(share.data.qr.startsWith('data:image/png;base64,'));
    const profile=await request('/me/profile',{pseudo:'Lot2HTTP',avatar:'cat',country:'TN',languages:['ar']});assert.equal(profile.data.avatar,'cat');assert.equal(profile.data.gifts.eligible,false);
    assert.equal((await request('/wallet/daily-bonus',{})).data.amount,5);
    assert.equal((await request('/wallet?limit=1')).data.silver,5);
    assert.equal((await request('/wallet?limit=1000')).status,400);
    const question={category:'fixture',language:'fr',difficulty:1,status:'draft',text:'X'.repeat(1000),choices:['A','B','C','D'],correctIndex:0,explanation:'Explanation',source:'Fixture'};
    const imported=await request('/v1/admin/questions/import',{questions:Array.from({length:20},()=>question)});
    assert.equal(imported.status,200);assert.equal(imported.data.imported,20);
    await store.pool.query("UPDATE user_roles SET role='moderator' WHERE user_id=$1",[id]);
    assert.equal((await request('/v1/admin/game-settings',{daily_bonus:1000})).status,403);
    assert.equal((await request('/v1/admin/wallet/reconcile',{repair:true})).status,403);
  }finally{if(app)await app.close();await store.close();}
});
