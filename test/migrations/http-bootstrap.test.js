import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {embeddedStore} from '../helpers/embedded-store.js';
import {bootstrapStaff} from '../../src/bootstrap-staff.js';
import {createApp} from '../../src/server.js';

test('fresh PostgreSQL engine, migrations, bootstrap and real HTTP authorization', async () => {
  const store = await embeddedStore();
  let app;
  try {
    await store.migrate();
    const password = randomUUID();
    await bootstrapStaff(store, {username:'zoubair', password});
    // Redis transport/rate limiting requires the separate native integration suite.
    const subscriber = {isOpen:true, on(){}, async connect(){}, async subscribe(){}, async quit(){this.isOpen=false;}};
    const security = {prefix:'bootstrap-test:', async limit(){}, client:{duplicate:()=>subscriber}};
    app = createApp({store, security, provider:{real:true}, config:{mode:'production', tickMs:60000}});
    await app.ready;
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const request = async (path, {token, body} = {}) => {
      const response = await fetch(base+path, {method:body?'POST':'GET', headers:{'content-type':'application/json', ...(token?{authorization:'Bearer '+token}:{})}, ...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status, data:await response.json()};
    };
    assert.equal((await request('/v1/admin/auth/login', {body:{username:'zoubair', password:'wrong'}})).status,401);
    const login = await request('/v1/admin/auth/login', {body:{username:'zoubair', password}});
    assert.equal(login.status,200);
    const token = login.data.accessToken;
    assert.equal((await request('/v1/admin/audit', {token})).status,200);
    assert.equal((await request('/v1/admin/audit')).status,401);
    assert.equal((await request('/wallet', {token})).status,403);
    const changed = await request('/v1/admin/auth/password', {token, body:{currentPassword:password, newPassword:randomUUID()}});
    assert.equal(changed.status,200);
    assert.equal((await request('/v1/admin/audit', {token})).status,401);
    assert.equal((await request('/v1/admin/audit', {token:changed.data.accessToken})).status,200);
  } finally {
    if (app) await app.close();
    await store.close();
  }
});
