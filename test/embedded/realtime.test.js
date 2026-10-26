import test from 'node:test';
import {embeddedStore} from '../helpers/embedded-store.js';
import {realtimeScenarios} from '../helpers/realtime-scenarios.js';
test('two-player OTP and WebSocket flow on two gateways',async t=>{
  const store=await embeddedStore();try{await realtimeScenarios(t,store);}finally{await store.close();}
});
