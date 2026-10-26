import { randomUUID } from 'node:crypto';
import { integer, requireRule } from './rules.js';
import { CompetitionEngine } from './competition-engine.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class Competitions {
  constructor(store) { this.store = store; this.engine=new CompetitionEngine(store); }
  async administrator(c, userId) {
    const { rows } = await c.query('SELECT role FROM user_roles WHERE user_id=$1 FOR SHARE', [userId]);
    requireRule(rows[0]?.role === 'administrator', 'Administrator required', 403);
  }
  async audit(c, actor, action, target, details = {}) {
    await c.query('INSERT INTO admin_audit(id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), actor, action, target, JSON.stringify(details)]);
  }
  async create(user, body) {
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
    return this.store.transaction(async c => {
      await this.administrator(c, user.id);
      const {rows: [clock]} = await c.query('SELECT clock_timestamp() AS now');
      requireRule(Date.parse(body.startsAt) > new Date(clock.now).getTime() + 600000, 'Schedule at least ten minutes ahead');
      const {rows: [row]} = await c.query(`INSERT INTO competitions(id,title,starts_at,time_zone,silver_cost,minimum_players,categories,question_language,question_limit,question_difficulty,repetition_days)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [randomUUID(),body.title.trim(),body.startsAt,body.timeZone,body.silverCost,body.minimumPlayers,JSON.stringify([...new Set(body.categories)]),language,limit,body.difficulty??null,repetitionDays]);
      await this.audit(c, user.id, 'competition.create', row.id);
      await c.query('UPDATE competitions SET milestone_golden=$2,winner_golden=$3,phase_one_limit=$4 WHERE id=$1',[row.id,milestone,winner,phaseOneLimit]);
      row.phase_one_limit=phaseOneLimit;
      row.milestone_golden=milestone;row.winner_golden=winner;
      return row;
    });
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
        await c.query("UPDATE competitions SET state='INSCRIPTIONS_OUVERTES',revision=revision+1 WHERE id=$1", [id]);
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
      if (row.silver_cost) await this.store.post(c, {userId:user.id, amount:-row.silver_cost, reason:'competition_registration',refId:id,key:`competition:${id}:entry:${user.id}`});
      const {rows: [registration]} = await c.query('INSERT INTO competition_registrations(competition_id,user_id,paid_silver) VALUES($1,$2,$3) RETURNING *', [id,user.id,row.silver_cost]);
      await c.query('UPDATE competitions SET revision=revision+1 WHERE id=$1',[id]);
      return registration;
    });
  }
  async cancelLocked(c, row, reason) {
    if (row.state === 'ANNULEE') return;
    requireRule(['PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES'].includes(row.state), 'Competition already started', 409);
    const {rows} = await c.query('SELECT * FROM competition_registrations WHERE competition_id=$1 ORDER BY user_id FOR UPDATE',[row.id]);
    for (const r of rows) {
      if (r.paid_silver) await this.store.post(c,{userId:r.user_id,amount:r.paid_silver,reason:'competition_refund',refId:row.id,key:`competition:${row.id}:refund:${r.user_id}`});
    }
    await c.query('UPDATE competition_registrations SET refunded_at=clock_timestamp() WHERE competition_id=$1 AND refunded_at IS NULL',[row.id]);
    await c.query("UPDATE competitions SET state='ANNULEE',cancellation_reason=$2,revision=revision+1 WHERE id=$1",[row.id,reason]);
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
      if(['PHASE_1','PALIER_ATTEINT','PHASE_2'].includes(row.state)) return this.engine.advance(c,row,now);
      if (!['PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES'].includes(row.state)) return;
      if (!row.questions_frozen_at && now >= start - 600000) {
        // Serialize selections across competitions so the anti-repeat window cannot race.
        await c.query('SELECT pg_advisory_xact_lock(21410003)');
        const {rows:questions}=await c.query(`SELECT q.* FROM editorial_questions q
          WHERE q.status='validated' AND q.language=$1 AND q.category=ANY($2::text[])
          AND ($4::int IS NULL OR q.difficulty=$4)
          AND NOT EXISTS(SELECT 1 FROM competition_questions cq JOIN competitions previous ON previous.id=cq.competition_id
            WHERE cq.question_id=q.id AND previous.state<>'ANNULEE'
            AND previous.questions_frozen_at>=clock_timestamp()-($5::int * interval '1 day'))
          ORDER BY q.id LIMIT $3 FOR SHARE OF q`,[row.question_language,row.categories,row.question_limit,row.question_difficulty,row.repetition_days]);
        if (questions.length < row.question_limit) {
          await this.cancelLocked(c,row,'insufficient_catalog');return;
        }
        for (const [position,q] of questions.entries()) await c.query('INSERT INTO competition_questions(competition_id,position,question_id,version,snapshot) VALUES($1,$2,$3,$4,$5)',[id,position,q.id,q.version,JSON.stringify(q)]);
        await c.query('UPDATE competitions SET questions_frozen_at=clock_timestamp(),revision=revision+1 WHERE id=$1',[id]);
      }
      if (now < start - 300000) return;
      const {rows:[count]} = await c.query('SELECT count(*)::int AS n FROM competition_registrations WHERE competition_id=$1',[id]);
      if (count.n < row.minimum_players) await this.cancelLocked(c,row,'minimum_not_reached');
      else if (now >= start) await this.engine.start(c,row);
      else if (row.state !== 'INSCRIPTIONS_CLOSES') await c.query("UPDATE competitions SET state='INSCRIPTIONS_CLOSES',revision=revision+1 WHERE id=$1",[id]);
    });
  }
  async list(user, id) {
    if (id) requireRule(uuid.test(id), 'Invalid competition ID');
    const {rows} = await this.store.pool.query(`SELECT c.*,r.registered_at,r.refunded_at,r.paid_silver,
      (SELECT count(*)::int FROM competition_registrations p WHERE p.competition_id=c.id) AS participants,
      clock_timestamp() AS server_time, true AS gameplay_enabled
      FROM competitions c LEFT JOIN competition_registrations r ON r.competition_id=c.id AND r.user_id=$1
      ${id ? 'WHERE c.id=$2' : ''} ORDER BY c.starts_at DESC,c.id LIMIT 100`,id?[user.id,id]:[user.id]);
    if (id) requireRule(rows.length, 'Competition not found',404);
    const safe=rows.map(({tie_seed,...row})=>row);
    return id ? safe[0] : {competitions:safe};
  }
  async play(user,id,body) {
    return this.store.transaction(async c=>{
      const row=await this.locked(c,id);
      return body?this.engine.answer(c,row,user,body):this.engine.view(c,row,user);
    });
  }
  async leaderboard(period='all') {
    requireRule(['all','week','month'].includes(period),'Invalid ranking period');
    const {rows}=await this.store.pool.query(`SELECT u.id,u.pseudo,count(*)::int AS wins FROM competition_registrations r JOIN users u ON u.id=r.user_id JOIN competitions c ON c.id=r.competition_id
      WHERE c.state='TERMINEE' AND r.final_rank=1
      AND ($1='all' OR c.finished_at>=date_trunc(CASE WHEN $1='month' THEN 'month' ELSE 'week' END,clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      GROUP BY u.id,u.pseudo ORDER BY wins DESC,u.id LIMIT 100`,[period]);
    return {period,ranking:rows};
  }
}
