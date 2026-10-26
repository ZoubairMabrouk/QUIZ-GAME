import test from 'node:test';
import assert from 'node:assert/strict';
import {roundOutcome,cumulativeOrder,seedCommitment} from '../src/competition-rules.js';
const players=n=>Array.from({length:n},(_,i)=>({id:String(i),correct:true,responseMs:i*10,cumulativeMs:i*20,receivedMs:i}));
test('strict ceiling keeps all small groups; no implicit acceleration',()=>{
  for(let n=1;n<=9;n++) assert.equal(roundOutcome(players(n),'PHASE_1',100,'seed').survivors.length,n);
  assert.equal(roundOutcome(players(10),'PHASE_1',100,'seed').survivors.length,9);
});
test('wrong answers excluded; all wrong replay; final reduces',()=>{
  const p=players(3);p[0].correct=false;
  assert.deepEqual(roundOutcome(p,'PHASE_1',100,'seed').survivors.map(p=>p.id),['1','2']);
  assert.equal(roundOutcome(p.map(x=>({...x,correct:false})),'PHASE_1',100,'seed').allWrong,true);
  assert.equal(roundOutcome(players(3),'PHASE_2',100,'seed').survivors.length,2);
});
test('cutoff cumulative then received; final exact ties use reproducible committed draw',()=>{
  const p=players(10).map(x=>({...x,responseMs:100,cumulativeMs:100,receivedMs:100}));
  p[0].cumulativeMs=0;
  assert.equal(roundOutcome(p,'PHASE_1',100,'seed').survivors[0].id,'0');
  assert.deepEqual(cumulativeOrder(p,'seed'),cumulativeOrder([...p].reverse(),'seed'));
  assert.equal(seedCommitment('seed').length,64);
});
