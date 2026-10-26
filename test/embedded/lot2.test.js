import test from 'node:test';
import {embeddedStore} from '../helpers/embedded-store.js';
import {lot2Scenarios} from '../helpers/lot2-scenarios.js';
test('Lot 2 PostgreSQL embedded catalogue, rooms, people and economy',async t=>{
  const store=await embeddedStore();try{await lot2Scenarios(t,store);}finally{await store.close();}
});
