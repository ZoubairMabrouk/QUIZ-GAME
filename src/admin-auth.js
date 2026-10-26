import {scrypt,randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {requireRule} from './rules.js';
const derive=promisify(scrypt);
async function matches(password,salt,hash){
  const actual=await derive(password,salt,64);
  return timingSafeEqual(actual,Buffer.from(hash,'hex'));
}
export class AdminAuth {
  constructor({store,security,config}){Object.assign(this,{store,security,config});}
  async login(body,ip){
    requireRule(typeof body.username==='string' && /^[a-zA-Z0-9_.-]{3,64}$/.test(body.username),'Invalid administrator credentials',401);
    requireRule(typeof body.password==='string' && body.password.length>0 && body.password.length<=1024,'Invalid administrator credentials',401);
    const username=body.username.toLowerCase();
    await this.security.limit('admin-login-ip',ip,20,60);
    await this.security.limit('admin-login-account',username,5,60);
    return this.store.transaction(async c=>{
      const {rows:[account]}=await c.query(`SELECT a.*,u.pseudo,r.role FROM admin_credentials a JOIN users u ON u.id=a.user_id
        LEFT JOIN user_roles r ON r.user_id=a.user_id WHERE a.username=$1 FOR SHARE OF a`,[username]);
      const valid=await matches(body.password,account?.password_salt??'0'.repeat(32),account?.password_hash??'0'.repeat(128));
      requireRule(account && valid && account.role==='administrator' && !(this.config.mode==='production' && account.development_only),'Invalid administrator credentials',401);
      await c.query('INSERT INTO admin_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$2)',[randomUUID(),account.user_id,'admin.login']);
      return {user:{id:account.user_id,username:account.username,pseudo:account.pseudo,role:account.role},...(await this.store.session(c,account.user_id,undefined,'admin'))};
    });
  }
  async changePassword(user,body){
    requireRule(user.audience==='admin','Administrator password session required',403);
    requireRule(typeof body.currentPassword==='string' && body.currentPassword.length<=1024,'Invalid current password');
    requireRule(typeof body.newPassword==='string' && body.newPassword.length>=12 && body.newPassword.length<=1024,'New password must contain 12–1024 characters');
    requireRule(body.newPassword!==body.currentPassword,'Choose a different password');
    return this.store.transaction(async c=>{
      const {rows:[account]}=await c.query('SELECT * FROM admin_credentials WHERE user_id=$1 FOR UPDATE',[user.id]);
      requireRule(account && await matches(body.currentPassword,account.password_salt,account.password_hash),'Invalid current password',403);
      const salt=randomBytes(16).toString('hex'),hash=(await derive(body.newPassword,salt,64)).toString('hex');
      await c.query('UPDATE admin_credentials SET password_salt=$2,password_hash=$3,development_only=false,updated_at=clock_timestamp() WHERE user_id=$1',[user.id,salt,hash]);
      await c.query("UPDATE session_families SET revoked_at=clock_timestamp() WHERE user_id=$1 AND audience='admin'",[user.id]);
      await c.query('INSERT INTO admin_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$2)',[randomUUID(),user.id,'admin.password_change']);
      return this.store.session(c,user.id,undefined,'admin');
    });
  }
}
