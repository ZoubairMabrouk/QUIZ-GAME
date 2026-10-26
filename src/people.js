import {randomUUID} from 'node:crypto';
import {requireRule} from './rules.js';
import {Competitions} from './competitions.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class People {
  constructor(store){this.store=store;}
  async profile(user,body){
    if(body){
      requireRule(typeof body.pseudo==='string'&&/^[\p{L}\p{N}_-]{3,24}$/u.test(body.pseudo),'Invalid pseudo');
      requireRule(['owl','fox','cat','lion','star'].includes(body.avatar??'owl'),'Invalid avatar');
      requireRule(body.country==null||/^[A-Z]{2}$/.test(body.country),'Invalid country');
      requireRule(Array.isArray(body.languages??['fr'])&&(body.languages??['fr']).length>0&&(body.languages??['fr']).length<=3&&(body.languages??['fr']).every(x=>['fr','en','ar'].includes(x)),'Invalid languages');
      if(body.birthDate!=null)requireRule(typeof body.birthDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)&&Number.isFinite(Date.parse(body.birthDate))&&new Date(body.birthDate).toISOString().slice(0,10)===body.birthDate&&body.birthDate<=new Date().toISOString().slice(0,10),'Invalid birth date');
      try{await this.store.pool.query('UPDATE users SET pseudo=$2,avatar=$3,country=$4,languages=$5,birth_date=$6 WHERE id=$1 AND deleted_at IS NULL',[user.id,body.pseudo,body.avatar??'owl',body.country??null,JSON.stringify([...new Set(body.languages??['fr'])]),body.birthDate??null]);}
      catch(e){if(e.code==='23505')requireRule(false,'Pseudo already used',409);throw e;}
    }
    const {rows:[row]}=await this.store.pool.query(`SELECT u.*,birth_date::text AS birth_date_text,
      (SELECT count(*)::int FROM game_results WHERE user_id=u.id) AS games,
      (SELECT count(*)::int FROM game_results WHERE user_id=u.id AND rank=1) AS wins,
      (SELECT COALESCE(sum(score),0)::text FROM game_results WHERE user_id=u.id) AS score,
      (SELECT count(*)::int FROM competition_registrations WHERE user_id=u.id AND final_rank=1) AS competition_wins,
      (birth_date IS NOT NULL AND birth_date<=(CURRENT_DATE-(s.gift_min_age*interval '1 year'))::date) AS age_eligible
      FROM users u CROSS JOIN game_settings s WHERE u.id=$1 AND u.deleted_at IS NULL`,[user.id]);
    requireRule(row,'Account unavailable',401);
    return {...this.store.publicUser(row),avatar:row.avatar,country:row.country,languages:row.languages,birthDate:row.birth_date_text,
      statistics:{games:row.games,wins:row.wins,score:row.score,competitionWins:row.competition_wins},
      badges:[...(row.games>0?['first_game']:[]),...(row.wins>=10?['ten_wins']:[]),...(row.competition_wins>0?['competition_winner']:[])],
      gifts:{eligible:false,ageEligible:row.age_eligible,phoneVerified:!!row.phone_verified_at,countryDeclared:!!row.country,verificationRequired:true,reason:'Real gifts disabled; declared age and country are not verified eligibility'}};
  }
  async friends(user,{offset=0,limit=50}={}){
    ({offset,limit}=new Competitions(this.store).pagination({offset,limit}));
    const {rows}=await this.store.pool.query(`SELECT f.sender_id,f.recipient_id,f.status,f.created_at,u.id,u.pseudo,u.avatar FROM friendships f
      JOIN users u ON u.id=CASE WHEN f.sender_id=$1 THEN f.recipient_id ELSE f.sender_id END
      WHERE (f.sender_id=$1 OR f.recipient_id=$1) AND u.deleted_at IS NULL ORDER BY f.created_at DESC,u.id LIMIT $2 OFFSET $3`,[user.id,limit+1,offset]);
    return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
  }
  async friend(user,body){
    return this.store.transaction(async c=>{
      if(body.action==='request'){
        requireRule(typeof body.pseudo==='string'&&body.pseudo.length<=24,'Invalid pseudo');
        const {rows:[target]}=await c.query("SELECT id FROM users WHERE lower(pseudo)=lower($1) AND account_kind='player' AND deleted_at IS NULL",[body.pseudo]);
        requireRule(target&&target.id!==user.id,'Player not found',404);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[[user.id,target.id].sort().join(':')]);
        await c.query('INSERT INTO friendships(sender_id,recipient_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,target.id]);
        return {requested:true};
      }
      requireRule(typeof body.userId==='string'&&uuid.test(body.userId)&&['accept','decline','remove'].includes(body.action),'Invalid friendship action');
      const {rowCount}=await c.query(`UPDATE friendships SET status=$3 WHERE
        (sender_id=$1 AND recipient_id=$2 AND $4='remove') OR
        (sender_id=$2 AND recipient_id=$1 AND ($4='remove' OR status='pending'))`,[user.id,body.userId,body.action==='accept'?'accepted':'declined',body.action]);
      requireRule(rowCount,'Friend request not found',404);return {updated:true};
    });
  }
  async invite(user,body){
    requireRule(typeof body.userId==='string'&&uuid.test(body.userId)&&typeof body.code==='string'&&/^[A-Z2-9]{6}$/.test(body.code),'Invalid invitation');
    return this.store.transaction(async c=>{
      const {rows:[room]}=await c.query('SELECT id,state FROM rooms WHERE code=$1 FOR SHARE',[body.code]);
      requireRule(room?.state.status==='lobby'&&room.state.players.some(p=>p.id===user.id),'Lobby membership required',403);
      requireRule(!(room.state.kicked??[]).includes(body.userId),'Removed from room',403);
      const {rowCount}=await c.query("SELECT 1 FROM friendships WHERE status='accepted' AND ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))",[user.id,body.userId]);
      requireRule(rowCount,'Accepted friendship required',403);
      await c.query('INSERT INTO room_invitations(id,room_id,sender_id,recipient_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),room.id,user.id,body.userId]);
      return {invited:true};
    });
  }
  async invitations(user){
    const {rows}=await this.store.pool.query(`SELECT i.id,i.created_at,r.code,r.state->>'name' AS name,r.state->>'status' AS status,u.pseudo AS sender
      FROM room_invitations i JOIN rooms r ON r.id=i.room_id JOIN users u ON u.id=i.sender_id
      WHERE i.recipient_id=$1 AND u.deleted_at IS NULL ORDER BY i.created_at DESC,i.id LIMIT 100`,[user.id]);return {items:rows};
  }
  async export(user){
    return this.store.transaction(async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result={format:'quiz-game-export-v1',generatedAt:new Date().toISOString()};
      const queries={profile:'SELECT id,pseudo,phone,phone_verified_at,avatar,country,languages,birth_date,created_at FROM users WHERE id=$1',
        ledger:'SELECT * FROM ledger WHERE user_id=$1 ORDER BY created_at,id',wallet:'SELECT * FROM wallet_accounts WHERE user_id=$1',
        games:'SELECT * FROM game_results WHERE user_id=$1',competitions:'SELECT * FROM competition_registrations WHERE user_id=$1',
        answers:'SELECT * FROM competition_answers WHERE user_id=$1',exposures:'SELECT * FROM question_exposures WHERE user_id=$1',
        friends:'SELECT * FROM friendships WHERE sender_id=$1 OR recipient_id=$1',invitations:'SELECT * FROM room_invitations WHERE sender_id=$1 OR recipient_id=$1',
        bonuses:'SELECT * FROM daily_bonus_claims WHERE user_id=$1',notifications:'SELECT * FROM competition_notifications WHERE user_id=$1'};
      for(const [key,sql] of Object.entries(queries))result[key]=(await c.query(sql,[user.id])).rows;
      return result;
    });
  }
  async remove(user,body){
    requireRule(body.confirm==='DELETE','Deletion confirmation required');
    return this.store.transaction(async c=>{
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      const {rowCount}=await c.query(`SELECT 1 FROM room_memberships m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=$1 AND NOT m.kicked AND r.state->>'status' IN ('question','results')
        UNION ALL SELECT 1 FROM competition_registrations p JOIN competitions c ON c.id=p.competition_id WHERE p.user_id=$1 AND c.state NOT IN ('TERMINEE','ANNULEE') LIMIT 1`,[user.id]);
      requireRule(!rowCount,'Finish or cancel active registrations before deletion',409);
      await c.query("UPDATE users SET pseudo=$2,phone=NULL,phone_verified_at=NULL,avatar='owl',country=NULL,languages='[]',birth_date=NULL,deleted_at=clock_timestamp() WHERE id=$1",[user.id,'Deleted_'+user.id]);
      await c.query('UPDATE session_families SET revoked_at=clock_timestamp() WHERE user_id=$1',[user.id]);
      for(const table of ['question_exposures','competition_connections'])await c.query(`DELETE FROM ${table} WHERE user_id=$1`,[user.id]);
      await c.query('DELETE FROM friendships WHERE sender_id=$1 OR recipient_id=$1',[user.id]);
      await c.query('DELETE FROM user_roles WHERE user_id=$1',[user.id]);
      await c.query('DELETE FROM room_invitations WHERE sender_id=$1 OR recipient_id=$1',[user.id]);
      const {rows:rooms}=await c.query("SELECT r.id,r.state FROM rooms r JOIN room_memberships m ON m.room_id=r.id WHERE m.user_id=$1 ORDER BY r.id FOR UPDATE OF r",[user.id]);
      for(const room of rooms){
        room.state.players=room.state.players.map(p=>p.id===user.id?{...p,pseudo:'Deleted player'}:p);
        if(room.state.status==='lobby'){room.state.players=room.state.players.filter(p=>p.id!==user.id);if(room.state.hostId===user.id)room.state.hostId=room.state.players[0]?.id??null;}
        room.state.revision=(room.state.revision??0)+1;
        await c.query('UPDATE rooms SET state=$2 WHERE id=$1',[room.id,room.state]);
      }
      return {deleted:true,retained:'Anonymized account identifier, immutable ledger, financial audit and game results retained; no legal retention period asserted'};
    });
  }
}
