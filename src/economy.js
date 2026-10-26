import {randomUUID} from 'node:crypto';
import {integer,requireRule} from './rules.js';
import {Competitions} from './competitions.js';
export class Economy {
  constructor(store){this.store=store;this.admin=new Competitions(store);}
  async settings(user,body){
    return this.store.transaction(async c=>{
      await this.admin.administrator(c,user.id);
      if(body){
        const limits={daily_silver_cap:[0,1000000],daily_bonus:[0,1000],room_question_limit:[1,200],room_player_limit:[2,100],repetition_days:[0,365],rewarded_games_per_day:[0,100],gift_min_age:[18,100]};
        for(const [key,value] of Object.entries(body)){
          requireRule(key in limits,'Unknown setting');integer(value,...limits[key],key);
          await c.query(`UPDATE game_settings SET ${key}=$1 WHERE id=true`,[value]);
        }
        await this.admin.audit(c,user.id,'settings.update',user.id,body);
      }
      return (await c.query('SELECT * FROM game_settings WHERE id=true')).rows[0];
    });
  }
  async bonus(user){
    return this.store.transaction(async c=>{
      const {rows:[account]}=await c.query('SELECT id,phone_verified_at,deleted_at FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      requireRule(account?.phone_verified_at && !account.deleted_at,'Verified phone required',403);
      const {rows:[clock]}=await c.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day");
      const {rows:[old]}=await c.query('SELECT amount FROM daily_bonus_claims WHERE user_id=$1 AND day=$2',[user.id,clock.day]);
      if(old)return {claimed:true,amount:old.amount,day:clock.day};
      const {rows:[settings]}=await c.query('SELECT daily_bonus FROM game_settings WHERE id=true');
      const entry=settings.daily_bonus?await this.store.post(c,{userId:user.id,amount:settings.daily_bonus,reason:'daily_bonus',refId:clock.day,key:`daily:${user.id}:${clock.day}`}):{amount:0};
      await c.query('INSERT INTO daily_bonus_claims(user_id,day,amount) VALUES($1,$2,$3)',[user.id,clock.day,entry.amount]);
      return {claimed:true,amount:entry.amount,day:clock.day};
    });
  }
  async reconcile({repair=false,after=null,limit=100}={}){
    integer(limit,1,1000,'reconciliation limit');
    const {rows}=await this.store.pool.query('SELECT user_id FROM wallet_accounts WHERE ($1::uuid IS NULL OR user_id>$1::uuid) ORDER BY user_id LIMIT $2',[after,limit]);
    let mismatches=0;
    for(const {user_id} of rows)await this.store.transaction(async c=>{
      const {rows:[account]}=await c.query('SELECT * FROM wallet_accounts WHERE user_id=$1 FOR UPDATE',[user_id]);
      const {rows:[totals]}=await c.query("SELECT COALESCE(sum(amount) FILTER(WHERE currency='silver'),0)::text AS silver,COALESCE(sum(amount) FILTER(WHERE currency='golden'),0)::text AS golden FROM ledger WHERE user_id=$1",[user_id]);
      if(BigInt(account.silver_balance)===BigInt(totals.silver)&&BigInt(account.golden_balance)===BigInt(totals.golden))return;
      mismatches++;
      requireRule(BigInt(totals.silver)>=0n&&BigInt(totals.golden)>=0n,'Negative ledger total requires investigation',409);
      if(repair)await c.query('UPDATE wallet_accounts SET silver_balance=$2,golden_balance=$3 WHERE user_id=$1',[user_id,totals.silver,totals.golden]);
      const auditId=randomUUID();
      await c.query('INSERT INTO wallet_reconciliations(id,user_id,old_silver,old_golden,ledger_silver,ledger_golden,repaired) VALUES($1,$2,$3,$4,$5,$6,$7)',[auditId,user_id,account.silver_balance,account.golden_balance,totals.silver,totals.golden,repair]);
      await this.admin.audit(c,null,'wallet.reconciliation',user_id,{reconciliationId:auditId,repaired:repair});
    });
    return {checked:rows.length,mismatches,next:rows.length===limit?rows.at(-1).user_id:null};
  }
}
