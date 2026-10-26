import { randomInt, randomUUID } from "node:crypto";
import {PersistentCatalog} from "./persistent-catalog.js";
import {Competitions} from "./competitions.js";
import { integer, requireRule, scoreAnswer } from "./rules.js";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export class DurableRooms {
  constructor(store) {
    this.store = store;
    this.catalog = new PersistentCatalog(store);
  }
  async now(c) {
    return Number(
      (await c.query("SELECT EXTRACT(EPOCH FROM clock_timestamp())*1000 AS ms"))
        .rows[0].ms,
    );
  }
  async create(user,body={},connection) {
    const {questionCount=3,durationMs=10000,mode='room',categories=[],language='fr',visibility='private',name='Quiz entre amis'}=body;
    requireRule(['room','solo','duel'].includes(mode),'Invalid game mode');
    requireRule(['private','public'].includes(visibility),'Invalid visibility');
    requireRule(typeof name==='string' && name.trim().length>=3 && name.length<=80,'Invalid room name');
    const run=async c=>{
      const {rows:[settings]}=await c.query('SELECT * FROM game_settings WHERE id=true');
      const maxPlayers=mode==='solo'?1:mode==='duel'?2:(body.maxPlayers??8);
      integer(questionCount,1,settings.room_question_limit,'questionCount');
      integer(durationMs,1000,60000,'durationMs');integer(maxPlayers,mode==='solo'?1:2,settings.room_player_limit,'maxPlayers');
      const {rowCount:active}=await c.query('SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[user.id]);
      requireRule(active,'Account unavailable',401);
      const selected=await this.catalog.select(c,{users:[user.id],categories,language,count:questionCount,repetitionDays:settings.repetition_days});
      const pool=selected.map(q=>({...q.content,id:q.id,version:q.version,category:q.category,difficulty:q.difficulty}));
      for(let attempt=0;attempt<5;attempt++){
        const code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');
        const now=await this.now(c);
        const room={id:randomUUID(),code,name:name.trim(),categories,language,visibility,mode,maxPlayers,durationMs,index:-1,revision:0,
          hostId:user.id,status:'lobby',questions:pool,players:[this.player(user)],answers:{},rewards:[],kicked:[],rematchOf:connection?body.rematchOf??null:null};
        if(mode==='solo')this.next(room,now);
        const {rowCount}=await c.query('INSERT INTO rooms(id,code,state) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING',[room.id,code,room]);
        if(rowCount){if(mode==='solo')await this.catalog.expose(c,[user.id],selected,room.id);await c.query('INSERT INTO room_memberships(room_id,user_id) VALUES($1,$2)',[room.id,user.id]);return this.view(room,user,now);}
      }
      requireRule(false,'Room code allocation failed',503);
    };
    return connection?run(connection):this.store.transaction(run);
  }
  async rematch(user,code){
    return this.store.transaction(async c=>{
      const {rows:[old]}=await c.query('SELECT id,state FROM rooms WHERE code=$1 FOR UPDATE',[code]);
      requireRule(old?.state.status==='finished' && old.state.hostId===user.id,'Finished game and host required',403);
      const {rows:[existing]}=await c.query("SELECT state FROM rooms WHERE state->>'rematchOf'=$1",[old.id]);
      if(existing)return this.view(existing.state,user,await this.now(c));
      const r=old.state;
      return this.create(user,{name:r.name??'Revanche',mode:r.mode??'room',categories:r.categories??[],language:r.language??'fr',visibility:r.visibility??'private',maxPlayers:r.maxPlayers,questionCount:r.questions.length,durationMs:r.durationMs,rematchOf:old.id},c);
    });
  }
  async list(user,page={}){
    const {limit,offset}=new Competitions(this.store).pagination(page);
    const {rows}=await this.store.pool.query(`SELECT code,state->>'name' AS name,state->>'mode' AS mode,state->'categories' AS categories,
      jsonb_array_length(state->'players') AS players FROM rooms WHERE state->>'visibility'='public' AND state->>'status'='lobby'
      ORDER BY updated_at DESC,id LIMIT $1 OFFSET $2`,[limit+1,offset]);
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }
  async history(user,page={}){
    const {limit,offset}=new Competitions(this.store).pagination(page);
    const {rows}=await this.store.pool.query(`SELECT g.*,r.code,r.state->>'name' AS name FROM game_results g JOIN rooms r ON r.id=g.room_id
      WHERE g.user_id=$1 ORDER BY g.finished_at DESC,g.room_id LIMIT $2 OFFSET $3`,[user.id,limit+1,offset]);
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }
  player(user) {
    return {
      id: user.id,
      pseudo: user.pseudo,
      ready: false,
      score: 0,
      streak: 0,
      totalMs: 0,
      answeredTotal: 0,
      correctTotal: 0,
    };
  }
  async execute(user, code, action, body = {}) {
    return this.store.transaction(async (c) => {
      const {
        rows: [row],
      } = await c.query("SELECT state FROM rooms WHERE code=$1 FOR UPDATE", [
        code,
      ]);
      requireRule(row, "Room not found", 404);
      const r = row.state;
      const now = await this.now(c);
      const member = r.players.find((p) => p.id === user.id);
      requireRule(member || action === "join", "Room membership required", 403);
      requireRule(!(r.kicked??[]).includes(user.id),'Removed from room',403);
      await this.tick(c, r, now);
      let accepted;
      if (action === "join" && !member) {
        requireRule(r.status === "lobby", "Room already started", 409);
        requireRule(r.players.length < r.maxPlayers, "Room full", 409);
        r.players.push(this.player(user));
        await c.query('INSERT INTO room_memberships(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.id,user.id]);
      } else if (action === "ready") {
        requireRule(r.status === "lobby", "Not in lobby", 409);
        requireRule(typeof body.ready === "boolean", "Invalid ready");
        member.ready = body.ready;
      } else if (action === "start") {
        this.host(r, user);
        requireRule(r.status === "lobby", "Already started", 409);
        requireRule(
          r.players.length >= 2 && r.players.every((p) => p.ready),
          "At least two ready players required",
          409,
        );
        const {rows:[settings]}=await c.query('SELECT * FROM game_settings WHERE id=true');
        for(const player of [...r.players].sort((a,b)=>a.id.localeCompare(b.id)))await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[player.id]);
        const selected=await this.catalog.select(c,{users:r.players.map(p=>p.id),categories:r.categories??[],language:r.language??'fr',count:r.questions.length,repetitionDays:settings.repetition_days});
        r.questions=selected.map(q=>({...q.content,id:q.id,version:q.version,category:q.category,difficulty:q.difficulty}));
        await this.catalog.expose(c,r.players.map(p=>p.id),selected,r.id);
        this.next(r, now);
      } else if (action === "answers") {
        requireRule(r.status === "question", "Question closed", 409);
        requireRule(
          r.questions[r.index].id === body.questionId,
          "Stale question",
          409,
        );
        integer(body.choice, 0, 3, "choice");
        requireRule(!r.answers[user.id], "Already answered", 409);
        r.answers[user.id] = {
          choice: body.choice,
          elapsedMs: Math.max(0, now - r.startedAt),
        };
        accepted = { accepted: true, questionId: body.questionId };
      } else if (action === "next") {
        this.host(r, user);
        requireRule(r.status === "results", "Round not ready to advance", 409);
        this.next(r, now);
      }
      else if(action==='kick'){
        this.host(r,user);requireRule(r.status==='lobby','Lobby required',409);
        requireRule(body.userId!==user.id && r.players.some(p=>p.id===body.userId),'Invalid player');
        r.players=r.players.filter(p=>p.id!==body.userId);r.kicked=[...(r.kicked??[]),body.userId];
        await c.query('UPDATE room_memberships SET kicked=true WHERE room_id=$1 AND user_id=$2',[r.id,body.userId]);
      }else if(action==='host'){
        this.host(r,user);requireRule(r.status==='lobby' && r.players.some(p=>p.id===body.userId),'Invalid host transfer',409);r.hostId=body.userId;
      }else if(action==='leave'){
        requireRule(r.status==='lobby','Cannot leave active game',409);r.players=r.players.filter(p=>p.id!==user.id);
        if(r.hostId===user.id)r.hostId=r.players[0]?.id??null;
      }else requireRule(['join','ready','start','answers','next','state'].includes(action),'Unknown room action');
      r.revision=(r.revision??0)+1;
      await c.query(
        "UPDATE rooms SET state=$1,updated_at=now() WHERE code=$2",
        [r, code],
      );
      return accepted ?? this.view(r, user, now);
    });
  }
  async snapshot(user,code) {
    const {rows:[row]}=await this.store.pool.query("SELECT state,EXTRACT(EPOCH FROM clock_timestamp())*1000 AS ms FROM rooms WHERE code=$1",[code]);
    requireRule(row,'Room not found',404);requireRule(row.state.players.some(p=>p.id===user.id),'Room membership required',403);
    return this.view(row.state,user,Number(row.ms));
  }
  async settle(code) {
    return this.store.transaction(async c=>{
      const {rows:[row]}=await c.query('SELECT state FROM rooms WHERE code=$1 FOR UPDATE',[code]);
      if(!row)return false;const r=row.state,previous=r.status;await this.tick(c,r,await this.now(c));
      if(r.status===previous)return false;r.revision=(r.revision??0)+1;
      await c.query('UPDATE rooms SET state=$1,updated_at=now() WHERE code=$2',[r,code]);return true;
    });
  }
  host(r, user) {
    requireRule(r.hostId === user.id, "Host only", 403);
  }
  next(r, now) {
    r.index++;
    r.status = "question";
    r.startedAt = now;
    r.answers = {};
  }
  ranking(r) {
    return [...r.players]
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.totalMs - b.totalMs ||
          a.id.localeCompare(b.id),
      )
      .map((p, i) => ({
        id: p.id,
        pseudo: p.pseudo,
        score: p.score,
        rank: i + 1,
      }));
  }
  async tick(c, r, now) {
    if (r.status !== "question" || now < r.startedAt + r.durationMs) return;
    const q = r.questions[r.index];
    for (const p of r.players) {
      const a = r.answers[p.id];
      const result = scoreAnswer({
        correct: a?.choice === q.correctIndex,
        difficulty: q.difficulty,
        elapsedMs: a?.elapsedMs ?? r.durationMs,
        durationMs: r.durationMs,
        previousStreak: p.streak,
      });
      if(a)p.answeredTotal=(p.answeredTotal??0)+1;
      if(a?.choice===q.correctIndex)p.correctTotal=(p.correctTotal??0)+1;
      p.score += result.points;
      p.streak = result.streak;
      p.totalMs += a?.elapsedMs ?? r.durationMs;
    }
    r.status = r.index === r.questions.length - 1 ? "finished" : "results";
    if (r.status === "finished") {
      // Consistent wallet lock order avoids deadlocks for overlapping player groups.
      for (const p of this.ranking(r).sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        const player=r.players.find(x=>x.id===p.id);
        await c.query('SELECT user_id FROM wallet_accounts WHERE user_id=$1 FOR UPDATE',[p.id]);
        const {rows:[settings]}=await c.query('SELECT * FROM game_settings WHERE id=true');
        const {rows:[prior]}=await c.query("SELECT count(*)::int AS n FROM game_results WHERE user_id=$1 AND rewarded AND finished_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[p.id]);
        const eligible=(player.correctTotal??0)>0 && (player.answeredTotal??0)>=Math.ceil(r.questions.length*0.6) && prior.n<settings.rewarded_games_per_day;
        const entry = eligible?await this.store.post(c, {
          userId: p.id,
          amount: [20, 12, 8][p.rank - 1] ?? 3,
          reason: "room_reward",
          refId: r.id,
          key: `room:${r.id}:${p.id}`,
        }):{amount:0,reason:'participation_or_game_limit'};
        await c.query('INSERT INTO game_results(room_id,user_id,mode,score,rank,answered,rewarded) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[r.id,p.id,r.mode??'room',p.score,p.rank,player.answeredTotal??0,entry.amount>0]);
        r.rewards.push({
          userId: p.id,
          amount: entry.amount,
          ...(entry.amount === 0 ? { reason: "daily_cap" } : {}),
        });
      }
    }
  }
  view(r, user, now) {
    const q = r.questions[r.index];
    return {
      code: r.code,
      name:r.name??'Quiz',categories:r.categories??[],visibility:r.visibility??'private',mode:r.mode??'room',
      joinPath:'/join/'+r.code,
      revision: r.revision??0,
      selectedChoice: r.answers[user.id]?.choice??null,
      hostId: r.hostId,
      status: r.status,
      questionNumber: r.index + 1,
      questionCount: r.questions.length,
      durationMs: r.durationMs,
      serverTime: now,
      remainingMs:
        r.status === "question"
          ? Math.max(0, Math.ceil(r.startedAt + r.durationMs - now))
          : 0,
      players: r.players.map(({ id, pseudo, ready }) => ({
        id,
        pseudo,
        ready,
      })),
      ranking: this.ranking(r),
      answered: !!r.answers[user.id],
      question: q ? {id:q.id,category:q.category,text:q.text,choices:q.choices,difficulty:q.difficulty,media:q.media??null} : null,
      ...(["results", "finished"].includes(r.status)
        ? { correctIndex: q.correctIndex, explanation: q.explanation }
        : {}),
      ...(r.status === "finished" ? { rewards: r.rewards } : {}),
    };
  }
}
