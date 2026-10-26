import {setTimeout as wait} from 'node:timers/promises';
import {PostgresStore} from '../src/postgres.js';
import {Competitions} from '../src/competitions.js';

if(process.env.NODE_ENV==='production'||process.env.OTP_PROVIDER!=='mock')throw new Error('Accelerated demo requires explicit OTP_PROVIDER=mock and non-production mode');
const user={id:process.argv[2]};
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id??''))throw new Error('Existing administrator UUID required');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const store=PostgresStore.connect(process.env.DATABASE_URL),service=new Competitions(store);
let id;
try{
  const row=await service.create(user,{title:'DÉMO — compétition accélérée sans cadeaux réels',startsAt:new Date(Date.now()+720000).toISOString(),timeZone:'UTC',silverCost:0,minimumPlayers:2,categories:['science','maths','geography'],questionLimit:2,repetitionDays:0,milestoneGolden:1,winnerGolden:5});
  id=row.id;await service.open(user,id);
  console.log(`Demo ${id}: open the Flutter competition list and register two mock players. Waiting up to five minutes.`);
  let ready=false;
  for(let attempt=0;attempt<150;attempt++){
    const event=await service.list(user,id);
    if(event.participants>=2){ready=true;break;}
    await wait(2000);
  }
  if(!ready)throw new Error('Two registrations not received');
  await store.transaction(async c=>{
    await service.administrator(c,user.id);
    const row=await service.locked(c,id);
    if(row.state!=='INSCRIPTIONS_OUVERTES')throw new Error('Demo no longer open');
    // Only this newly-created, zero-cost mock event is accelerated.
    await c.query("UPDATE competitions SET starts_at=clock_timestamp()+interval '15 seconds',revision=revision+1 WHERE id=$1",[id]);
    await service.audit(c,user.id,'competition.demo_accelerate',id);
  });
  await service.reconcile();
  console.log('Registration closed. Game starts in 15 seconds; open Enter / Resume in Flutter. Keep the API running.');
}catch(e){
  if(id)await service.cancel(user,id).catch(()=>{});
  console.error(e.message);process.exitCode=1;
}finally{await store.close();}
