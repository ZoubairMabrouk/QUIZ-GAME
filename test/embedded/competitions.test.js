import test from 'node:test';
import {embeddedStore} from '../helpers/embedded-store.js';
import {competitionScenarios} from '../helpers/competition-scenarios.js';
import {engineScenarios} from '../helpers/competition-engine-scenarios.js';
test('Competition registration and refunds (embedded, no native concurrency claim)',async t=>{
  const store=await embeddedStore();
  try {await competitionScenarios(t,store);await engineScenarios(t,store);} finally {await store.close();}
});
