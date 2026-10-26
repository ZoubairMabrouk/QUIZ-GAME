import {createHash} from 'node:crypto';
import {requireRule} from './rules.js';

export const tieHash=(seed,id)=>createHash('sha256').update(`${seed}:${id}`).digest('hex');
export const seedCommitment=seed=>createHash('sha256').update(seed).digest('hex');

// The final draw is reproducible from the revealed seed and player UUIDs.
export function cumulativeOrder(players,seed) {
  return [...players].sort((a,b)=>a.cumulativeMs-b.cumulativeMs || tieHash(seed,a.id).localeCompare(tieHash(seed,b.id)));
}
export function roundOutcome(players,phase,initialCount,seed) {
  requireRule(players.length>0 && ['PHASE_1','PHASE_2'].includes(phase),'Invalid round');
  const correct=players.filter(p=>p.correct).sort((a,b)=>a.responseMs-b.responseMs || a.cumulativeMs-b.cumulativeMs || a.receivedMs-b.receivedMs || tieHash(seed,a.id).localeCompare(tieHash(seed,b.id)));
  // Explicit allowed fallback: everyone wrong -> replay with the next frozen question.
  if(!correct.length) return {survivors:players,eliminated:[],allWrong:true,milestone:false};
  const count=phase==='PHASE_1'?Math.ceil(correct.length*0.9):Math.max(1,Math.min(correct.length,players.length-1));
  const survivors=correct.slice(0,count), ids=new Set(survivors.map(p=>p.id));
  return {survivors,eliminated:cumulativeOrder(players.filter(p=>!ids.has(p.id)),seed),allWrong:false,milestone:phase==='PHASE_1' && count<=Math.max(1,Math.floor(initialCount*0.05))};
}
