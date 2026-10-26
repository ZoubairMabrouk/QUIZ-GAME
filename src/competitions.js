import {PersistentCatalog} from './persistent-catalog.js';
import { randomUUID } from 'node:crypto';
import { integer, requireRule } from './rules.js';
import { CompetitionEngine } from './competition-engine.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class Competitions {
  constructor(store) { this.store = store; this.engine=new CompetitionEngine(store); this.catalog=new PersistentCatalog(store); }
  async administrator(c, userId) {
    const { rows } = await c.query('SELECT role FROM user_roles WHERE user_id=$1 FOR SHARE', [userId]);
    requireRule(rows[0]?.role === 'administrator', 'Administrator required', 403);
  }
  async audit(c, actor, action, target, details = {}) {
    await c.query('INSERT INTO admin_audit(id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), actor, action, target, JSON.stringify(details)]);
  }
  async create(user, body, connection) {
    requireRule(typeof body.title === 'string' && body.title.trim().length >= 3 && body.title.length <= 120, 'Invalid title');
    requireRule(typeof body.startsAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(body.startsAt) && Number.isFinite(Date.parse(body.startsAt)), 'Explicit UTC offset required');
    requireRule(typeof body.timeZone === 'string' && body.timeZone.length <= 100, 'Invalid time zone');
    try { new Intl.DateTimeFormat('en', {timeZone: body.timeZone}); } catch { requireRule(false, 'Invalid time zone'); }
    integer(body.silverCost, 0, 1000000, 'silver cost');
    integer(body.minimumPlayers, 2, 100000, 'minimum players');
    const language=body.language??'fr',limit=body.questionLimit??30,repetitionDays=body.repetitionDays??7;
    requireRule(['fr','en','ar'].includes(language),'Invalid language');
    integer(limit,1,200,'question limit');integer(repetitionDays,0,365,'repetition days');
    const phaseOneLimit=body.phaseOneLimit??Math.min(29,limit);
    integer(phaseOneLimit,1,limit,'phase one limit');
    if(body.difficulty!==undefined) integer(body.difficulty,1,5,'difficulty');
    const milestone=body.milestoneGolden??1,winner=body.winnerGolden??5;
    integer(milestone,0,1000000,'milestone reward');integer(winner,0,1000000,'winner reward');
    requireRule(Array.isArray(body.categories) && body.categories.length > 0 && body.categories.length <= 20 && body.categories.every(x => typeof x === 'string' && /^[a-z0-9_-]{1,50}$/.test(x)), 'Invalid categories');
    // Gifts remain disabled until age, stock and eligibility controls are integrated.
    requireRule(!body.gifts && !body.rewards, 'Rewards configuration not enabled', 409);
    const run=async c => {
      await this.administrator(c, user.id);
      const {rows: [clock]} = await c.query('SELECT clock_timestamp() AS now');
      requireRule(Date.parse(body.startsAt) > new Date(clock.now).getTime() + 600000, 'Schedule at least ten minutes ahead');
      const {rows: [row]} = await c.query(`INSERT INTO competitions(id,title,starts_at,time_zone,silver_cost,minimum_players,categories,question_language,question_limit,question_difficulty,repetition_days)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [randomUUID(),body.title.trim(),body.startsAt,body.timeZone,body.silverCost,body.minimumPlayers,JSON.stringify([...new Set(body.categories)]),language,limit,body.difficulty??null,repetitionDays]);
      await this.audit(c, user.id, 'competition.create', row.id);
      await c.query('UPDATE competitions SET milestone_golden=$2,winner_golden=$3,phase_one_limit=$4 WHERE id=$1',[row.id,milestone,winner,phaseOneLimit]);
      row.phase_one_limit=phaseOneLimit;
      row.milestone_golden=milestone;row.winner_golden=winner;
      if(body.daily===true) {
        const scheduleId=randomUUID();
        await c.query(`INSERT INTO competition_schedules(id,actor_id,template,time_zone,local_time,next_at)
          VALUES($1,$2,$3,$4,($5::timestamptz AT TIME ZONE $4)::time,
            (($5::timestamptz AT TIME ZONE $4)+interval '1 day') AT TIME ZONE $4)`,
          [scheduleId,user.id,JSON.stringify({...body,daily:false}),body.timeZone,body.startsAt]);
        await c.query('UPDATE competitions SET schedule_id=$2 WHERE id=$1',[row.id,scheduleId]);
        row.schedule_id=scheduleId;
      }
      return row;
    };
    return connection?run(connection):this.store.transaction(run);
  }
  async locked(c, id) {
    requireRule(typeof id === 'string' && uuid.test(id), 'Invalid competition ID');
    const { rows: [row] } = await c.query('SELECT * FROM competitions WHERE id=$1 FOR UPDATE', [id]);
    requireRule(row, 'Competition not found', 404);
    return row;
  }
  async open(user, id) {
    return this.store.transaction(async c => {
      await this.administrator(c, user.id);
      const row = await this.locked(c, id);
      const {rows: [clock]} = await c.query('SELECT clock_timestamp() AS now');
      requireRule(new Date(clock.now).getTime() < new Date(row.starts_at).getTime() - 300000, 'Registration closed', 409);
      requireRule(['PLANIFIEE','INSCRIPTIONS_OUVERTES'].includes(row.state), 'Invalid competition state', 409);
      if (row.state === 'PLANIFIEE') {
        await c.query("UPDATE competitions SET state='INSCRIPTIONS_OUVERTES' WHERE id=$1", [id]);
        await this.engine.event(c,id);
        await this.audit(c, user.id, 'competition.open', id);
      }
      return {id, state:'INSCRIPTIONS_OUVERTES'};
    });
  }
  async register(user, id) {
    return this.store.transaction(async c => {
      const row = await this.locked(c, id);
      const {rows: [old]} = await c.query('SELECT * FROM competition_registrations WHERE competition_id=$1 AND user_id=$2', [id,user.id]);
      if (old) return old; // Retry after lost HTTP response, even after closure.
      const {rows: [clock]} = await c.query('SELECT clock_timestamp() AS now');
      requireRule(row.state === 'INSCRIPTIONS_OUVERTES' && new Date(clock.now).getTime() < new Date(row.starts_at).getTime() - 300000, 'Registration closed', 409);
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      const {rowCount:repeated}=await c.query(`SELECT 1 FROM competition_questions q JOIN question_exposures h ON h.question_id=q.question_id
        WHERE q.competition_id=$1 AND h.user_id=$2 AND h.seen_at>=clock_timestamp()-$3::int*interval '1 day' LIMIT 1`,[id,user.id,row.repetition_days]);
      requireRule(!repeated,'Frozen questions already seen recently',409);
      if (row.silver_cost) await this.store.post(c, {userId:user.id, amount:-row.silver_cost, reason:'competition_registration',refId:id,key:`competition:${id}:entry:${user.id}`});
      const {rows: [registration]} = await c.query('INSERT INTO competition_registrations(competition_id,user_id,paid_silver) VALUES($1,$2,$3) RETURNING *', [id,user.id,row.silver_cost]);
      const {rows:reserved}=await c.query('SELECT question_id AS id FROM competition_questions WHERE competition_id=$1',[id]);
      await this.catalog.expose(c,[user.id],reserved,id);
      await this.engine.event(c,id);
      return registration;
    });
  }
  async cancelLocked(c, row, reason, incident=false) {
    if (row.state === 'ANNULEE') return;
    requireRule(incident || ['PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES'].includes(row.state), 'Competition already started', 409);
    const {rows} = await c.query('SELECT * FROM competition_registrations WHERE competition_id=$1 ORDER BY user_id FOR UPDATE',[row.id]);
    for (const r of rows) {
      if (r.paid_silver) await this.store.post(c,{userId:r.user_id,amount:r.paid_silver,reason:'competition_refund',refId:row.id,key:`competition:${row.id}:refund:${r.user_id}`});
    }
    await c.query('UPDATE competition_registrations SET refunded_at=clock_timestamp() WHERE competition_id=$1 AND refunded_at IS NULL',[row.id]);
    await c.query("UPDATE competitions SET state='ANNULEE',cancellation_reason=$2 WHERE id=$1",[row.id,reason]);
    await this.audit(c,null,'competition.refund_cancel',row.id,{reason,incident,refundedPlayers:rows.length,preserveAwardedGolden:true});
    await this.engine.event(c,row.id);
  }
  async cancel(user,id) {
    return this.store.transaction(async c => {
      await this.administrator(c,user.id);
      const row = await this.locked(c,id);
      if (row.state !== 'ANNULEE') {
        await this.cancelLocked(c,row,'administrator');
        await this.audit(c,user.id,'competition.cancel',id);
      }
      return {id,state:'ANNULEE'};
    });
  }
  async reconcile() {
    if(Date.now()>=(this.maintenanceAt??0)) {
      await this.recurrences();await this.reminders();this.maintenanceAt=Date.now()+30000;
    }
    // One short locked transaction per competition. No Redis lease or stale owner:
    // all mutations are performed on the connection holding the row lock.
    const {rows} = await this.store.pool.query(`SELECT id FROM competitions WHERE
      (state IN ('PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES') AND starts_at <= clock_timestamp()+interval '10 minutes' AND (questions_frozen_at IS NULL OR starts_at <= clock_timestamp()+interval '5 minutes'))
      OR (state IN ('PHASE_1','PALIER_ATTEINT','PHASE_2') AND COALESCE(next_transition_at,question_deadline)<=clock_timestamp())
      ORDER BY COALESCE(next_transition_at,question_deadline,starts_at),id LIMIT 100`);
    for (const {id} of rows) await this.store.transaction(async c => {
      const row = await this.locked(c,id);
      const {rows:[clock]} = await c.query('SELECT clock_timestamp() AS now');
      const now = new Date(clock.now).getTime(), start = new Date(row.starts_at).getTime();
      const due=new Date(row.next_transition_at??row.question_deadline??row.starts_at).getTime();
      if(now-due>120000) return this.cancelLocked(c,row,'prolonged_incident',true);
      if(['PHASE_1','PALIER_ATTEINT','PHASE_2'].includes(row.state)) return this.engine.advance(c,row,now);
      if (!['PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES'].includes(row.state)) return;
      if (!row.questions_frozen_at && now >= start - 600000) {
        // Serialize selections across competitions so the anti-repeat window cannot race.
        const {rows:participants}=await c.query('SELECT user_id FROM competition_registrations WHERE competition_id=$1',[id]);
        for(const participant of [...participants].sort((a,b)=>a.user_id.localeCompare(b.user_id)))await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[participant.user_id]);
        await c.query('SELECT pg_advisory_xact_lock(21410003)');
        let questions;
        try { questions=await this.catalog.select(c,{users:participants.map(p=>p.user_id),categories:row.categories,language:row.question_language,count:row.question_limit,repetitionDays:row.repetition_days,globalRepeat:true,difficulty:row.question_difficulty}); }
        catch(e){if(e.status!==409)throw e;await this.cancelLocked(c,row,'insufficient_catalog');return;}
        for (const [position,q] of questions.entries()) await c.query('INSERT INTO competition_questions(competition_id,position,question_id,version,snapshot) VALUES($1,$2,$3,$4,$5)',[id,position,q.id,q.version,JSON.stringify(q)]);
        await this.catalog.expose(c,participants.map(p=>p.user_id),questions,id);
        await c.query('UPDATE competitions SET questions_frozen_at=clock_timestamp() WHERE id=$1',[id]);
        await this.engine.event(c,id);
      }
      if (now < start - 300000) return;
      const {rows:[count]} = await c.query('SELECT count(*)::int AS n FROM competition_registrations WHERE competition_id=$1',[id]);
      if (count.n < row.minimum_players) await this.cancelLocked(c,row,'minimum_not_reached');
      else if (now >= start) await this.engine.start(c,row);
      else if (row.state !== 'INSCRIPTIONS_CLOSES') {await c.query("UPDATE competitions SET state='INSCRIPTIONS_CLOSES' WHERE id=$1",[id]);await this.engine.event(c,id);}
    });
  }
  async list(user, id, page={}) {
    const {limit,offset}=this.pagination(page);
    if (id) requireRule(uuid.test(id), 'Invalid competition ID');
    const {rows} = await this.store.pool.query(`SELECT c.*,r.registered_at,r.refunded_at,r.paid_silver,
      (SELECT count(*)::int FROM competition_registrations p WHERE p.competition_id=c.id) AS participants,
      clock_timestamp() AS server_time, true AS gameplay_enabled
      FROM competitions c LEFT JOIN competition_registrations r ON r.competition_id=c.id AND r.user_id=$1
      ${id ? 'WHERE c.id=$2' : ''} ORDER BY c.starts_at DESC,c.id LIMIT ${limit+1} OFFSET ${id?0:offset}`,id?[user.id,id]:[user.id]);
    if (id) requireRule(rows.length, 'Competition not found',404);
    const safe=rows.map(({tie_seed,...row})=>row);
    return id ? safe[0] : {competitions:safe.slice(0,limit),nextOffset:safe.length>limit?offset+limit:null};
  }
  async receipt() {
    return (await this.store.pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
  }
  async presence(user,id,connectionId,connected=true) {
    requireRule(uuid.test(id) && uuid.test(connectionId),'Invalid presence');
    if(connected) await this.store.transaction(async c=>{
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      const {rows:[count]}=await c.query('SELECT count(*)::int AS n FROM competition_connections WHERE user_id=$1 AND id<>$2 AND disconnected_at IS NULL AND expires_at>clock_timestamp()',[user.id,connectionId]);
      requireRule(count.n<5,'Too many competition connections',429);
      await c.query(`INSERT INTO competition_connections(id,competition_id,user_id)
      VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET expires_at=clock_timestamp()+interval '15 seconds'
      WHERE competition_connections.user_id=$3 AND competition_connections.disconnected_at IS NULL`,[connectionId,id,user.id]);
    });
    else await this.store.pool.query('UPDATE competition_connections SET disconnected_at=COALESCE(disconnected_at,clock_timestamp()) WHERE id=$1 AND user_id=$2',[connectionId,user.id]);
  }
  async play(user,id,body,receivedAt) {
    requireRule(typeof id==='string' && uuid.test(id),'Invalid competition ID');
    if(body && !receivedAt) receivedAt=await this.receipt();
    return this.store.transaction(async c=>{
      if(!body) await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {rows:[row]}=await c.query('SELECT *,clock_timestamp() AS snapshot_time FROM competitions WHERE id=$1'+(body?' FOR SHARE':''),[id]);
      requireRule(row,'Competition not found',404);
      return body?this.engine.answer(c,row,user,body,receivedAt):this.engine.view(c,row,user);
    });
  }
  pagination({limit=50,offset=0}={}) {
    limit=Number(limit);offset=Number(offset);integer(limit,1,100,'page limit');integer(offset,0,1000000,'page offset');return {limit,offset};
  }
  async history(user,page={}) {
    const {limit,offset}=this.pagination(page);
    const {rows}=await this.store.pool.query(`SELECT c.id,c.title,c.starts_at,c.time_zone,c.state,r.registered_at,r.final_rank,r.eliminated_at,r.paid_silver,r.refunded_at,r.milestone_awarded,
      COALESCE((SELECT sum(l.amount) FROM ledger l WHERE l.user_id=r.user_id AND l.ref_id=c.id::text AND l.currency='golden'),0)::text AS golden_awarded
      FROM competition_registrations r JOIN competitions c ON c.id=r.competition_id WHERE r.user_id=$1
      ORDER BY r.registered_at DESC,c.id LIMIT $2 OFFSET $3`,[user.id,limit+1,offset]);
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }
  async reminders() {
    await this.store.pool.query(`INSERT INTO competition_notifications(competition_id,user_id,kind)
      SELECT c.id,r.user_id,t.kind FROM competitions c JOIN competition_registrations r ON r.competition_id=c.id
      CROSS JOIN (VALUES ('one_hour',interval '1 hour'),('five_minutes',interval '5 minutes')) t(kind,delay)
      WHERE c.state IN ('PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES') AND c.starts_at>clock_timestamp()
      AND c.starts_at-t.delay<=clock_timestamp() ON CONFLICT DO NOTHING`);
  }
  async notifications(user,page={}) {
    const {limit,offset}=this.pagination(page);
    const {rows}=await this.store.pool.query(`SELECT n.*,c.title,c.starts_at,c.time_zone FROM competition_notifications n
      JOIN competitions c ON c.id=n.competition_id WHERE n.user_id=$1 ORDER BY n.id DESC LIMIT $2 OFFSET $3`,[user.id,limit+1,offset]);
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }
  async recurrences() {
    const {rows}=await this.store.pool.query("SELECT id FROM competition_schedules WHERE enabled AND next_at<=clock_timestamp()+interval '1 day' ORDER BY next_at LIMIT 100");
    for(const {id} of rows)await this.store.transaction(async c=>{
      const {rows:[s]}=await c.query('SELECT *,clock_timestamp() AS now FROM competition_schedules WHERE id=$1 FOR UPDATE',[id]);
      if(!s.enabled || new Date(s.next_at).getTime()>new Date(s.now).getTime()+86400000)return;
      const {rows:[role]}=await c.query('SELECT role FROM user_roles WHERE user_id=$1',[s.actor_id]);
      if(role?.role!=='administrator'){await c.query('UPDATE competition_schedules SET enabled=false WHERE id=$1',[id]);return;}
      if(new Date(s.next_at).getTime()>new Date(s.now).getTime()+600000) {
        const row=await this.create({id:s.actor_id},{...s.template,startsAt:new Date(s.next_at).toISOString()},c);
        await c.query("UPDATE competitions SET schedule_id=$2,state='INSCRIPTIONS_OUVERTES' WHERE id=$1",[row.id,id]);
        await this.audit(c,s.actor_id,'competition.daily_occurrence',row.id,{scheduleId:id});
      }else await this.audit(c,s.actor_id,'competition.daily_missed',id,{startsAt:s.next_at});
      await c.query(`UPDATE competition_schedules SET next_at=(
        GREATEST((next_at AT TIME ZONE time_zone)::date+1,
          ((clock_timestamp()+interval '10 minutes') AT TIME ZONE time_zone)::date+
          CASE WHEN ((((clock_timestamp()+interval '10 minutes') AT TIME ZONE time_zone)::date+local_time) AT TIME ZONE time_zone)<=clock_timestamp()+interval '10 minutes' THEN 1 ELSE 0 END)
        +local_time) AT TIME ZONE time_zone WHERE id=$1`,[id]);
    });
  }
  async schedule(user,id,enabled) {
    requireRule(uuid.test(id) && typeof enabled==='boolean','Invalid schedule update');
    return this.store.transaction(async c=>{
      await this.administrator(c,user.id);
      const {rows:[row]}=await c.query('UPDATE competition_schedules SET enabled=$2 WHERE id=$1 RETURNING id,enabled,next_at',[id,enabled]);
      requireRule(row,'Schedule not found',404);await this.audit(c,user.id,'competition.schedule_update',id,{enabled});return row;
    });
  }
  async leaderboard(period='all',page={}) {
    const {limit,offset}=this.pagination(page);
    requireRule(['all','week','month'].includes(period),'Invalid ranking period');
    const {rows}=await this.store.pool.query(`SELECT u.id,u.pseudo,count(*)::int AS wins FROM competition_registrations r JOIN users u ON u.id=r.user_id JOIN competitions c ON c.id=r.competition_id
      WHERE c.state='TERMINEE' AND r.final_rank=1
      AND ($1='all' OR c.finished_at>=date_trunc(CASE WHEN $1='month' THEN 'month' ELSE 'week' END,clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      GROUP BY u.id,u.pseudo ORDER BY wins DESC,u.id LIMIT $2 OFFSET $3`,[period,limit+1,offset]);
    return {period,ranking:rows.slice(0,limit).map((r,i)=>({...r,rank:offset+i+1})),nextOffset:rows.length>limit?offset+limit:null};
  }
}
