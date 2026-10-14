// Banco PostgreSQL embarcado + API HTTP + navegador. Nenhum dispositivo real recebe avisos.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),os=require('node:os'),vm=require('node:vm');
const {createHash,createECDH,randomBytes}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {chromium,devices}=require('playwright');
const webpush=require('web-push');
const {createHandler}=require('../notifications.cjs');
const {build}=require('../scripts/build.cjs');
const admin='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
const hash=value=>createHash('sha256').update(value).digest('hex');
const identifier=value=>{assert.match(value,/^[a-z_]+$/);return '"'+value+'"';};
const value=(column,input)=>column==='subscription' ? JSON.stringify(input) : column==='system_ids' && Array.isArray(input) ? '{'+input.map(item=>JSON.stringify(item)).join(',')+'}' : input;
class Query {
  constructor(db,table){this.db=db;this.table=identifier(table);this.mode='select';this.columns='*';this.where=[];this.params=[];}
  select(columns='*'){this.columns=columns==='*' ? '*' : columns.split(',').map(identifier).join(',');return this;}
  eq(column,input){this.params.push(value(column,input));this.where.push(identifier(column)+'=$'+this.params.length);return this;}
  order(column,{ascending=true}={}){this.sort=identifier(column)+(ascending?' asc':' desc');return this;}
  limit(amount){assert.ok(Number.isInteger(amount));this.amount=amount;return this;}
  upsert(input,options={}){this.mode='upsert';this.input=input;this.ignore=options.ignoreDuplicates;return this;}
  update(input){this.mode='update';this.input=input;return this;}
  delete(){this.mode='delete';return this;}
  maybeSingle(){this.singleMode='maybe';return this;}
  single(){this.singleMode='required';return this;}
  async then(resolve,reject){
    try {
      const where=this.where.length ? ' where '+this.where.join(' and ') : '';
      let sql;
      if(this.mode==='select')sql='select '+this.columns+' from public.'+this.table+where+(this.sort?' order by '+this.sort:'')+(this.amount!==undefined?' limit '+this.amount:'');
      else if(this.mode==='delete')sql='delete from public.'+this.table+where+' returning *';
      else {
        const entries=Object.entries(this.input),columns=entries.map(([column])=>identifier(column));
        const slots=entries.map(([column,input])=>{this.params.push(value(column,input));return '$'+this.params.length;});
        if(this.mode==='update')sql='update public.'+this.table+' set '+columns.map((column,index)=>column+'='+slots[index]).join(',')+where+' returning *';
        else sql='insert into public.'+this.table+' ('+columns.join(',')+') values ('+slots.join(',')+') on conflict(id) '+(this.ignore?'do nothing':'do update set '+columns.filter(column=>column!=='"id"').map(column=>column+'=excluded.'+column).join(','))+' returning *';
      }
      const rows=JSON.parse(JSON.stringify((await this.db.query(sql,this.params)).rows));
      resolve({data:this.singleMode ? rows[0] || null : rows,error:null});
    } catch(error){resolve({data:null,error});}
  }
}
(async()=>{
  const db=new PGlite(),output=await fs.mkdtemp(path.join(os.tmpdir(),'central-push-'));
  let browser,server,origin,handler,sendError,gate;
  const sent=[];
  try {
    await db.exec('create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create role anon;create role authenticated;create role service_role bypassrls;');
    await db.exec(await fs.readFile(path.join(__dirname,'../supabase/setup.sql'),'utf8'));
    const sql=await fs.readFile(path.join(__dirname,'../supabase/migrations/20261012224258_push_notifications.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);
    await db.query('insert into auth.users values($1),($2)',[admin,other]);await db.query('insert into public.central_admins(user_id,is_primary) values($1,true),($2,false)',[admin,other]);
    for(const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      for(const table of ['central_push_config','central_push_events','central_push_devices']) await assert.rejects(db.query('select * from public.'+table),/permission denied/);
      await assert.rejects(db.query("select public.central_push_summary('fake')"),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const client={
      auth:{getUser:async token=>({data:{user:token==='admin' ? {id:admin} : token==='other' ? {id:other} : token==='viewer' ? {id:'10000000-0000-0000-0000-000000000099'} : null},error:null})},
      from:table=>new Query(db,table),
      async rpc(name,args={}){
        try{const keys=Object.keys(args),slots=keys.map((key,index)=>identifier(key)+' => $'+(index+1));
          const params=Object.entries(args).map(([key,input])=>key==='p_subscription' ? JSON.stringify(input) : key==='p_system_ids' ? value('system_ids',input) : input);
          const rows=(await db.query('select * from public.'+identifier(name)+'('+slots.join(',')+')',params)).rows;
          return {data:name==='central_push_claim' ? JSON.parse(JSON.stringify(rows)) : rows[0]?.[name] ?? null,error:null};
        }catch(error){return {data:null,error};}
      }
    };
    server=http.createServer(async(req,res)=>{
      if(req.url.startsWith('/api/notifications')) {
        if(req.headers['x-test-parsed']){const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=JSON.parse(Buffer.concat(chunks));}
        return handler(req,res);
      }
      const filename=req.url==='/'?'index.html':req.url.split('?')[0].slice(1);
      if(!['index.html','dashboard.css','notifications.js','service-worker.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/badge.png'].includes(filename)){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':filename.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8');
      res.end(await fs.readFile(path.join(output,filename)));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
    handler=createHandler({client,centralOrigin:origin,send:async(sub,data,options)=>{
      if(gate)await gate;if(sendError){const error=sendError;sendError=null;throw error;}
      // O receptor de teste usa HTTP em loopback; a identidade VAPID representa a origem HTTPS publicada.
      const details=webpush.generateRequestDetails(sub,data,{...options,vapidDetails:{...options.vapidDetails,subject:'https://central-test.example'}});
      assert.ok(details.body.length>100);assert.ok(details.headers.Authorization || details.headers.authorization);
      sent.push({sub,value:JSON.parse(data),options});return {statusCode:201};
    }});
    const call=async(method,body,token='admin',action='',headers={})=>{
      const response=await fetch(origin+'/api/notifications'+action,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,value:await response.json()};
    };
    assert.equal((await call('GET',null,'')).status,401);assert.equal((await call('GET',null,'viewer')).status,403);
    assert.equal((await call('GET',null,'admin','',{Origin:'https://evil.example'})).status,403);
    const state=(await call('GET')).value;
    const cfg=(await db.query('select * from public.central_push_config')).rows[0];
    assert.equal(state.publicKey,cfg.public_key);assert.ok(!JSON.stringify(state).includes(cfg.private_key));assert.ok(!JSON.stringify(state).includes(cfg.dispatch_token));
    assert.equal((await call('POST',{},'wrong','?action=dispatch')).status,401);
    const dispatch=()=>call('POST',{},cfg.dispatch_token,'?action=dispatch');
    const ecdh=createECDH('prime256v1');ecdh.generateKeys();
    const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
    const report=async(index,project='central-demo',ready=true)=>{
      await db.query('insert into public.central_reports(key,project_id,report,attachments,digest,sender_hash,ready) values($1,$2,$3,$4,$5,$6,$7)',[hash(String(index)),project,JSON.stringify({id:String(index),title:'Relato '+index,type:'bug'}),'[]','test','sender',ready]);
    };
    await report(1,'central-demo',false);assert.equal((await db.query('select count(*)::int as n from public.central_push_events')).rows[0].n,0);
    await db.query('update public.central_reports set ready=true where key=$1',[hash('1')]);
    let result=await call('POST',{subscription:sub,systemIds:null},'admin','',{'x-test-parsed':'1'});assert.equal(result.status,200);const id=result.value.id;
    assert.equal((await call('GET',null,'other','?device='+id)).value.device,null);
    assert.equal((await dispatch()).value.sent,0,'Não notificar relatos anteriores à ativação.');
    for(const endpoint of ['https://127.0.0.1/private','https://supabase.example/data','http://fcm.googleapis.com/a'])assert.equal((await call('POST',{subscription:{...sub,endpoint},systemIds:null})).status,400);
    assert.equal((await call('POST',{subscription:sub,systemIds:[]})).status,400);
    assert.equal((await call('POST',{subscription:sub,systemIds:['missing']})).status,400);
    await report(2);await report(3,'radar-contratual');
    result=await dispatch();assert.equal(result.value.sent,1);assert.equal(sent[0].value.total,2);assert.equal(sent[0].value.userId,admin);assert.equal(sent[0].value.body,'Central · Testes: 1 · Radar Contratual: 1');
    assert.equal((await dispatch()).value.sent,0,'Retentativa não repete o aviso.');
    assert.equal((await db.query('select count(*)::int as n from public.central_push_events')).rows[0].n,3);
    await db.query('update public.central_reports set ready=true where key=$1',[hash('2')]);assert.equal((await db.query('select count(*)::int as n from public.central_push_events')).rows[0].n,3);
    await call('POST',{cursor:999999},'admin','?action=seen');
    assert.equal((await db.query('select seen_id from public.central_push_devices where id=$1',[id])).rows[0].seen_id,3);
    await call('POST',{subscription:sub,systemIds:['radar-contratual']});
    await report(4);assert.equal((await dispatch()).value.sent,0);
    await report(5,'radar-contratual');assert.equal((await dispatch()).value.sent,1);assert.equal(sent.at(-1).value.total,1);
    await report(6,'radar-contratual');sendError=Object.assign(new Error('transient'),{statusCode:503});
    assert.equal((await dispatch()).value.failed,1);assert.equal((await dispatch()).value.sent,0);
    await db.query("update public.central_push_devices set lease_until=now()-interval '1 second'");assert.equal((await dispatch()).value.sent,1);
    await report(7,'radar-contratual');let release;gate=new Promise(resolve=>release=resolve);
    const simultaneous=dispatch();await new Promise(resolve=>setTimeout(resolve,80));assert.equal((await dispatch()).value.sent,0,'Só um worker obtém o dispositivo.');release();await simultaneous;gate=null;

    await build(output); // Instalação da UI testada com API autenticada e Service Worker real.
    const pageHTML=await fs.readFile(path.join(__dirname,'../index.html'),'utf8');
    await fs.writeFile(path.join(output,'index.html'),pageHTML.replace('<script defer src="/dashboard.js"></script>',`<script>window.startNotifications=()=>{CentralNotifications.setProjects([{id:'central-demo',name:'Central · Testes'},{id:'radar-contratual',name:'Radar Contratual'}]);return CentralNotifications.start({userId:'${admin}',api:async(url,options={})=>{const response=await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer admin'}});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}});};window.addEventListener('DOMContentLoaded',startNotifications);</script>`));
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const context=await browser.newContext({...devices['Pixel 7']});await context.grantPermissions(['notifications'],{origin});
    context.setDefaultTimeout(10000);
    await context.addInitScript(subscription=>{
      window.nativeNotices=[];window.fakeSub=null;
      window.fakePermission='granted';
      Object.defineProperty(Notification,'permission',{configurable:true,get:()=>window.fakePermission});
      Notification.requestPermission=async()=>window.fakePermission;
      PushManager.prototype.getSubscription=async()=>window.fakeSub;
      PushManager.prototype.subscribe=async()=>window.fakeSub={endpoint:subscription.endpoint,toJSON:()=>subscription,unsubscribe:async()=>{window.fakeSub=null;return true;}};
      ServiceWorkerRegistration.prototype.showNotification=async(title,options)=>{window.nativeNotices.push({title,options});};
    },sub);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
    await page.evaluate(()=>fakePermission='denied');
    await page.getByRole('button',{name:'Notificações',exact:false}).click();
    await page.getByText(/O navegador bloqueou as notificações/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Ativar neste dispositivo',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Fechar notificações'}).click();await page.evaluate(()=>fakePermission='granted');
    await page.getByRole('button',{name:'Notificações',exact:false}).click();
    await page.getByRole('button',{name:'Ativar neste dispositivo',exact:true}).click();await page.getByText('Notificações ativadas neste dispositivo.',{exact:true}).waitFor();
    await page.getByLabel('Todos os sistemas',{exact:false}).uncheck();
    await page.getByLabel('Radar Contratual',{exact:true}).check();
    await page.getByLabel('Central · Testes',{exact:true}).uncheck();
    await page.getByRole('button',{name:'Salvar sistemas acompanhados'}).click();
    await page.getByText('Notificações ativadas neste dispositivo.',{exact:true}).waitFor();
    assert.deepEqual((await db.query('select system_ids from public.central_push_devices where id=$1',[id])).rows[0].system_ids,['radar-contratual']);
    await page.getByRole('button',{name:'Enviar notificação de teste'}).click();assert.equal(await page.evaluate(()=>nativeNotices.at(-1).title),'Central de Bugs · teste');
    const second={...sub,endpoint:sub.endpoint+'-second'};await call('POST',{subscription:second,systemIds:null});
    await report(41,'radar-contratual');
    await page.evaluate(()=>startNotifications());
    assert.equal(await page.evaluate(()=>nativeNotices.at(-1).title),'Central de Bugs · 4 novos relatos');
    assert.match(await page.locator('#notifications-summary-text').innerText(),/4 novos relatos/);
    assert.equal((await call('GET',null,'admin','?device='+id)).value.summary.total,0,'O resumo inicial registra a consulta.');
    const cursors=(await db.query('select seen_id from public.central_push_devices')).rows;assert.equal(cursors[0].seen_id,cursors[1].seen_id,'Consulta sincronizada entre dispositivos da conta.');
    await call('DELETE',{id:hash(second.endpoint)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await fs.mkdir(path.join(__dirname,'../artifacts/notifications'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../artifacts/notifications/preferencias-mobile.png')});
    await page.getByRole('button',{name:'Desativar neste dispositivo'}).click();await page.getByText('Notificações desativadas neste dispositivo.',{exact:true}).waitFor();
    assert.equal((await db.query('select count(*)::int as n from public.central_push_devices')).rows[0].n,0);
    assert.equal(await page.getByRole('button',{name:'Ativar neste dispositivo'}).isEnabled(),true);
    assert.deepEqual(errors,[]);
    await call('POST',{subscription:sub,systemIds:null});await report(8);
    sendError=Object.assign(new Error('gone'),{statusCode:410});assert.equal((await dispatch()).value.expired,1);assert.equal((await db.query('select count(*)::int as n from public.central_push_devices')).rows[0].n,0);
    // Todas as notificações respeitam propriedade e supervisão, inclusive após revogação.
    assert.equal((await call('POST',{subscription:sub,systemIds:['radar-contratual']},'other')).status,400);
    const privateSub={...sub,endpoint:sub.endpoint+'-isolated-account'};
    const privateDevice=(await call('POST',{subscription:privateSub,systemIds:null},'other')).value.id;
    await report(701,'radar-contratual');
    assert.equal((await call('GET',null,'other','?device='+privateDevice)).value.summary.total,0);
    assert.equal((await dispatch()).value.sent,0);
    await db.query('update public.central_projects set supervisor_ids=array[$1::uuid] where id=$2',[other,'radar-contratual']);
    assert.equal((await call('GET',null,'other','?device='+privateDevice)).value.summary.total,1);
    assert.equal((await dispatch()).value.sent,1);assert.equal(sent.at(-1).value.userId,other);
    await report(702,'radar-contratual');
    await db.query("update public.central_projects set supervisor_ids='{}' where id='radar-contratual'");
    assert.equal((await call('GET',null,'other','?device='+privateDevice)).value.summary.total,0);
    assert.equal((await dispatch()).value.sent,0);
    await call('DELETE',{id:privateDevice},'other');
    const caps=await Promise.all(Array.from({length:11},(_,index)=>call('POST',{subscription:{...sub,endpoint:sub.endpoint+'-limit-'+index},systemIds:null},'other')));
    assert.equal(caps.filter(item=>item.status===200).length,10);assert.equal(caps.filter(item=>item.status===409).length,1);
    await db.query('delete from public.central_admins where user_id=$1',[other]);
    assert.equal((await db.query('select count(*)::int as n from public.central_push_devices')).rows[0].n,0,'Revogar administrador remove seus dispositivos.');
    await call('POST',{subscription:sub,systemIds:null});await report(99);
    const injected=handler,originalSend=webpush.sendNotification;let defaultBinding=false;
    webpush.sendNotification=function(){defaultBinding=this===webpush;return Promise.resolve({statusCode:201});};
    handler=createHandler({client,centralOrigin:origin});assert.equal((await dispatch()).value.sent,1);assert.equal(defaultBinding,true);
    webpush.sendNotification=originalSend;handler=injected;

    // Handler do SW: identidade, privacidade e navegação segura, sem API nativa de notificação no host.
    const handlers={},cache=new Map(),notices=[],opened=[];
    const worker={location:{origin},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(title,options)=>notices.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
    vm.runInNewContext(await fs.readFile(path.join(__dirname,'../service-worker.js'),'utf8'),{self:worker,URL,Response,navigator:{},caches:{open:async()=>({match:async key=>cache.get(key)?.clone(),put:async(key,response)=>cache.set(key,response),delete:async key=>cache.delete(key)})}});
    const fire=async(name,fields)=>{let pending;handlers[name]({...fields,waitUntil:value=>pending=value});await pending;};
    await fire('message',{data:{type:'identity',userId:admin},ports:[{postMessage(){}}]});
    await fire('push',{data:{json:()=>({...sent[0].value,userId:other})}});assert.equal(notices.length,0);
    await fire('push',{data:{json:()=>sent[0].value}});assert.equal(notices.length,1);assert.equal(notices[0].options.tag,'central-new-reports');
    await fire('notificationclick',{notification:{close(){},data:{url:'https://evil.example/'}}});assert.equal(opened[0],origin+'/');
    await fire('message',{data:{type:'identity',userId:''},ports:[{postMessage(){}}]});
    await fire('push',{data:{json:()=>sent[0].value}});assert.equal(notices.length,1,'Sair da conta impede exibir dados de novos pushes.');
    console.log('OK: fila após confirmação, agrupamento/filtros, inscrições privadas, VAPID/criptografia, autenticação, deduplicação, lease/retry/410, UI mobile, desativação, identidade do SW e navegação segura.');
  }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)console.error(await page.evaluate(()=>({message:document.querySelector('#notifications-message')?.textContent,permission:Notification.permission,supported:{serviceWorker:'serviceWorker' in navigator,push:'PushManager' in window}})));throw error;}
  finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();await fs.rm(output,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
