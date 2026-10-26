import {randomBytes} from 'node:crypto';
import {integer,requireRule} from './rules.js';
import {seedCommitment,roundOutcome,cumulativeOrder} from './competition-rules.js';

const active=['PHASE_1','PALIER_ATTEINT','PHASE_2'];
export class CompetitionEngine {
  constructor(store) {this.store=store;}
  async event(c,id) {
    await c.query('UPDATE competitions SET revision=revision+1 WHERE id=$1',[id]);
    await c.query('INSERT INTO competition_events(competition_id,revision,state) SELECT id,revision,state FROM competitions WHERE id=$1',[id]);
  }
  async start(c,row) {
    const seed=randomBytes(32).toString('hex');
    await c.query(`UPDATE competitions SET state='PHASE_1',initial_players=(SELECT count(*) FROM competition_registrations WHERE competition_id=$1),tie_seed=$2,tie_commitment=$3 WHERE id=$1`,[row.id,seed,seedCommitment(seed)]);
    await this.next(c,{...row,current_question:-1,state:'PHASE_1'});
  }
  async next(c,row) {
    await c.query(`UPDATE competitions SET current_question=$2,question_started_at=clock_timestamp(),question_deadline=clock_timestamp()+interval '10 seconds',next_transition_at=NULL WHERE id=$1`,[row.id,row.current_question+1]);
    await this.event(c,row.id);
  }
  async credit(c,row,players,kind,amount) {
    if(!amount) return;
    for(const p of [...players].sort((a,b)=>a.id.localeCompare(b.id)))
      await this.store.post(c,{userId:p.id,currency:'golden',amount,reason:`competition_${kind}`,refId:row.id,key:`competition:${row.id}:${kind}:${p.id}`});
  }
  async milestone(c,row,players) {
    await this.credit(c,row,players,'milestone',row.milestone_golden);
    await c.query('UPDATE competition_registrations SET milestone_awarded=true WHERE competition_id=$1 AND eliminated_at IS NULL',[row.id]);
    await c.query("UPDATE competitions SET state='PALIER_ATTEINT',next_transition_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",[row.id]);
  }
  async finish(c,row,players,reason) {
    const ordered=cumulativeOrder(players,row.tie_seed);
    for(const [index,p] of ordered.entries()) await c.query('UPDATE competition_registrations SET final_rank=$3,eliminated_at=CASE WHEN $3::int=1 THEN NULL ELSE $4::int END WHERE competition_id=$1 AND user_id=$2',[row.id,p.id,index+1,row.current_question]);
    await this.credit(c,row,[ordered[0]],'winner',row.winner_golden);
    await c.query("UPDATE competitions SET state='TERMINEE',finished_at=clock_timestamp(),next_transition_at=NULL,resolution_reason=$2 WHERE id=$1",[row.id,reason]);
    await this.event(c,row.id);
  }
  async players(c,row) {
    const {rows}=await c.query(`SELECT r.user_id AS id,r.cumulative_ms,a.choice,a.response_ms,a.received_at
      FROM competition_registrations r LEFT JOIN competition_answers a ON a.competition_id=r.competition_id AND a.user_id=r.user_id AND a.question_no=$2
      WHERE r.competition_id=$1 AND r.eliminated_at IS NULL ORDER BY r.user_id`,[row.id,row.current_question]);
    return rows;
  }
  async advance(c,row,now) {
    if(!active.includes(row.state)) return;
    if(row.next_transition_at) {
      if(now<new Date(row.next_transition_at).getTime()) return;
      const {rows:[count]}=await c.query('SELECT count(*)::int AS n FROM competition_questions WHERE competition_id=$1',[row.id]);
      const raw=await this.players(c,row);
      const players=raw.map(p=>({id:p.id,cumulativeMs:Number(p.cumulative_ms)}));
      if(row.state==='PALIER_ATTEINT') {
        await c.query("UPDATE competitions SET state='PHASE_2' WHERE id=$1",[row.id]);
        await this.event(c,row.id);
        // Persist PHASE_2 as an observable transition before final settlement.
        await c.query("UPDATE competitions SET next_transition_at=clock_timestamp()+interval '1 second' WHERE id=$1",[row.id]);
        return;
      }
      if(players.length===1) return this.finish(c,row,players,'last_survivor');
      if(row.current_question+1>=count.n) return this.finish(c,row,players,'question_limit_cumulative_draw');
      return this.next(c,row);
    }
    if(now<new Date(row.question_deadline).getTime()) return;
    const {rows:[already]}=await c.query('SELECT 1 FROM competition_rounds WHERE competition_id=$1 AND question_no=$2',[row.id,row.current_question]);
    if(already) return;
    const {rows:[question]}=await c.query('SELECT snapshot FROM competition_questions WHERE competition_id=$1 AND position=$2',[row.id,row.current_question]);
    requireRule(question,'Frozen question missing',409);
    const raw=await this.players(c,row);
    // A disconnected/missing player may resynchronize for 24 seconds. This delays
    // settlement only; answer() still enforces the original ten-second deadline.
    if(raw.some(p=>p.choice===null) && now<new Date(row.question_deadline).getTime()+24000) return;
    const players=raw.map(p=>({id:p.id,correct:p.choice===question.snapshot.content.correctIndex,responseMs:p.response_ms??10000,cumulativeMs:Number(p.cumulative_ms)+(p.response_ms??10000),receivedMs:p.received_at?new Date(p.received_at).getTime():new Date(row.question_deadline).getTime()}));
    const outcome=roundOutcome(players,row.state,row.initial_players,row.tie_seed);
    if(row.state==='PHASE_1' && row.current_question+1>=Math.min(row.phase_one_limit,row.question_limit) && !outcome.milestone) {
      const ordered=cumulativeOrder(outcome.survivors,row.tie_seed);
      const count=Math.max(1,Math.floor(row.initial_players*0.05));
      outcome.survivors=ordered.slice(0,count);
      outcome.eliminated=cumulativeOrder([...outcome.eliminated,...ordered.slice(count)],row.tie_seed);
      outcome.milestone=true;
    }
    for(const p of players) await c.query('UPDATE competition_registrations SET cumulative_ms=$3 WHERE competition_id=$1 AND user_id=$2',[row.id,p.id,p.cumulativeMs]);
    for(const [index,p] of outcome.eliminated.entries()) await c.query('UPDATE competition_registrations SET eliminated_at=$3,final_rank=$4 WHERE competition_id=$1 AND user_id=$2',[row.id,p.id,row.current_question,outcome.survivors.length+index+1]);
    await c.query('INSERT INTO competition_rounds(competition_id,question_no,phase,survivors,all_wrong) VALUES($1,$2,$3,$4,$5)',[row.id,row.current_question,row.state,outcome.survivors.length,outcome.allWrong]);
    await c.query("UPDATE competitions SET next_transition_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",[row.id]);
    if(outcome.milestone) await this.milestone(c,row,outcome.survivors);
    await this.event(c,row.id);
  }
  async answer(c,row,user,body) {
    integer(body.questionNo,0,199,'question number');integer(body.choice,0,3,'choice');
    const {rows:[registration]}=await c.query('SELECT * FROM competition_registrations WHERE competition_id=$1 AND user_id=$2',[row.id,user.id]);
    requireRule(registration,'Registration required',403);
    const {rows:[old]}=await c.query('SELECT choice FROM competition_answers WHERE competition_id=$1 AND question_no=$2 AND user_id=$3',[row.id,body.questionNo,user.id]);
    if(old) {requireRule(old.choice===body.choice,'Answer conflict',409);return {accepted:true,questionNo:body.questionNo,revision:Number(row.revision)};}
    requireRule(['PHASE_1','PHASE_2'].includes(row.state) && registration.eliminated_at===null && !row.next_transition_at && body.questionNo===row.current_question,'Question closed',409);
    // One authoritative timestamp, sampled after acquiring the competition lock.
    const {rows:[clock]}=await c.query('SELECT clock_timestamp() AS now');
    const now=new Date(clock.now).getTime(),start=new Date(row.question_started_at).getTime();
    requireRule(now>=start && now<new Date(row.question_deadline).getTime(),'Question closed',409);
    await c.query('INSERT INTO competition_answers(competition_id,question_no,user_id,choice,response_ms,received_at) VALUES($1,$2,$3,$4,$5,$6)',[row.id,body.questionNo,user.id,body.choice,Math.min(9999,Math.floor(now-start)),clock.now]);
    const {rows:[updated]}=await c.query('UPDATE competitions SET revision=revision+1 WHERE id=$1 RETURNING revision',[row.id]);
    return {accepted:true,questionNo:body.questionNo,revision:Number(updated.revision)};
  }
  async view(c,row,user) {
    const {rows:[me]}=await c.query('SELECT * FROM competition_registrations WHERE competition_id=$1 AND user_id=$2',[row.id,user.id]);
    requireRule(me,'Registration required',403);
    await c.query('UPDATE competition_registrations SET last_seen_at=clock_timestamp() WHERE competition_id=$1 AND user_id=$2',[row.id,user.id]);
    const {rows:[counts]}=await c.query('SELECT count(*)::int AS participants,count(*) FILTER(WHERE eliminated_at IS NULL)::int AS survivors FROM competition_registrations WHERE competition_id=$1',[row.id]);
    const {rows:[clock]}=await c.query('SELECT clock_timestamp() AS now');
    const result={id:row.id,title:row.title,state:row.state,revision:Number(row.revision),serverTime:clock.now,startsAt:row.starts_at,deadline:row.question_deadline,nextTransitionAt:row.next_transition_at,questionNo:row.current_question,...counts,me:{eliminated:me.eliminated_at!==null,rank:me.final_rank,cumulativeMs:Number(me.cumulative_ms),milestoneAwarded:me.milestone_awarded,refunded:!!me.refunded_at},tieCommitment:row.tie_commitment,resolutionReason:row.resolution_reason};
    if(row.current_question>=0) {
      const {rows:[question]}=await c.query('SELECT snapshot FROM competition_questions WHERE competition_id=$1 AND position=$2',[row.id,row.current_question]);
      const {rows:[answer]}=await c.query('SELECT choice FROM competition_answers WHERE competition_id=$1 AND question_no=$2 AND user_id=$3',[row.id,row.current_question,user.id]);
      if(question) {
        const q=question.snapshot;
        result.question={text:q.content.text,choices:q.content.choices,difficulty:q.difficulty};
        result.myChoice=answer?.choice??null;
        const {rowCount}=await c.query('SELECT 1 FROM competition_rounds WHERE competition_id=$1 AND question_no=$2',[row.id,row.current_question]);
        if(rowCount) result.correction={correctIndex:q.content.correctIndex,explanation:q.content.explanation};
      }
    }
    if(row.state==='TERMINEE') {
      result.tieSeed=row.tie_seed;
      const {rows}=await c.query('SELECT u.pseudo,r.final_rank AS rank,r.cumulative_ms FROM competition_registrations r JOIN users u ON u.id=r.user_id WHERE competition_id=$1 ORDER BY final_rank LIMIT 100',[row.id]);
      result.results=rows;
      const {rows:rewards}=await c.query("SELECT currency,amount,reason FROM ledger WHERE user_id=$1 AND ref_id=$2 AND reason IN ('competition_milestone','competition_winner') ORDER BY reason",[user.id,row.id]);
      result.rewards=rewards;
    }
    return result;
  }
}
