import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from '../../admin/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';

const server=await createServer({root:fileURLToPath(new URL('../../admin/',import.meta.url)),server:{host:'127.0.0.1',port:0}});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let logins=0;
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let data={};
    if(path==='/api/v1/admin/auth/login'){
      const body=request.postDataJSON();
      assert.equal(body.username,'zoubair');assert.equal(body.password,'browser-fixture-only');logins++;
      data={accessToken:'a'.repeat(64),refreshToken:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',user:{username:'zoubair',role:'administrator'}};
    } else if(path==='/api/v1/competitions') data={competitions:[]};
    else if(path==='/api/v1/admin/audit')data={items:[{action:'admin.login'}]};
    else if(path==='/api/auth/logout')data={loggedOut:true};
    else throw new Error('Unexpected admin request');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('heading',{name:'Connexion administrateur'}).waitFor();
  assert.equal(await page.getByLabel('Téléphone international').count(),0);
  await page.getByLabel('Nom d’utilisateur').fill('zoubair');
  const password=page.getByLabel('Mot de passe',{exact:true});
  assert.equal(await password.getAttribute('type'),'password');
  await password.fill('browser-fixture-only');await password.press('Enter');
  await page.getByRole('heading',{name:'Planifier une compétition'}).waitFor();assert.equal(logins,1);
  await page.getByRole('button',{name:'audit',exact:true}).click();
  await page.getByRole('button',{name:'Charger les dernières actions'}).click();
  await page.locator('pre').filter({hasText:'admin.login'}).waitFor();
  await page.getByRole('button',{name:'Déconnexion',exact:true}).click();
  await page.getByRole('heading',{name:'Connexion administrateur'}).waitFor();
  assert.equal(await page.locator('pre').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Admin username/password browser login and logout passed (API mocked; native HTTP auth tested separately).');
}finally {await browser?.close();await server.close();}
