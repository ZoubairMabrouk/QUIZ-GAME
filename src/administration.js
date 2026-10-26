import {Competitions} from './competitions.js';
import {integer,requireRule} from './rules.js';
export class Administration {
  constructor(store){this.store=store;this.permissions=new Competitions(store);}
  async read(user,resource,offset=0){
    integer(offset,0,1000000,'offset');
    requireRule(['audit','ledger','users'].includes(resource),'Unknown resource');
    return this.store.transaction(async c=>{
      await this.permissions.administrator(c,user.id);
      const queries={audit:'SELECT * FROM admin_audit ORDER BY created_at DESC,id LIMIT 100 OFFSET $1',ledger:'SELECT * FROM ledger ORDER BY created_at DESC,id LIMIT 100 OFFSET $1',users:'SELECT id,pseudo,phone_verified_at IS NOT NULL AS phone_verified,created_at FROM users ORDER BY created_at DESC,id LIMIT 100 OFFSET $1'};
      const {rows}=await c.query(queries[resource],[offset]);
      return {items:rows,offset,nextOffset:rows.length===100?offset+100:null};
    });
  }
  async adjust(user,body){
    requireRule(typeof body.userId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.userId),'Invalid user ID');
    requireRule(typeof body.key==='string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.key),'Invalid adjustment key');
    requireRule(typeof body.reason==='string' && body.reason.trim().length>=5 && body.reason.length<=500,'Adjustment reason required');
    integer(body.amount,-1000000,1000000,'adjustment amount');
    return this.store.transaction(async c=>{
      await this.permissions.administrator(c,user.id);
      const entry=await this.store.post(c,{userId:body.userId,amount:body.amount,currency:body.currency??'silver',reason:'admin_adjustment',refId:user.id,key:`adjustment:${user.id}:${body.key}`});
      const {rows:[old]}=await c.query("SELECT details FROM admin_audit WHERE action='wallet.adjustment' AND target_id=$1",[entry.id]);
      if(old) requireRule(old.details.reason===body.reason,'Idempotency conflict',409);
      else await this.permissions.audit(c,user.id,'wallet.adjustment',entry.id,{reason:body.reason,userId:body.userId});
      return entry;
    });
  }
}
