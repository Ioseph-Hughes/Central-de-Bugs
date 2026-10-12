// Protocolo HTTP real com o SDK oficial e Supabase simulado. Não toca no projeto remoto.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { createHandler } = require('../api/reports.js');
const { build } = require('../scripts/build.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(),'central-cloud-'));
  const rows = new Map(), files = new Map(), uploadTokens = new Set(), payloads = [];
  let origin, handler, failCommit = false, failDelete = false, browser;
  const projects = [{id:'central-demo',name:'Central · Testes',origins:[]},{id:'radar-contratual',name:'Radar Contratual',origins:['https://radarcontratual.com']}];
  const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
  const read = async req => { const chunks=[]; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); };
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost'), p=url.pathname;
      if (p.startsWith('/api/')) { return await handler(req,res); }
      if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, apikey, x-client-info, x-upsert');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
      if (req.method==='OPTIONS') { res.writeHead(204); res.end(); return; }
      if (p==='/auth/v1/token') {
        const body=JSON.parse(await read(req));
        if (body.password!=='test-password') return json(res,400,{msg:'Invalid login',error_code:'invalid_credentials'});
        const admin=body.email==='admin@example.com', id=admin?'admin-user':'viewer-user';
        return json(res,200,{access_token:admin?'admin-token':'viewer-token',token_type:'bearer',refresh_token:'test-refresh',expires_in:3600,user:{id,email:body.email,aud:'authenticated'}});
      }
      if (p==='/auth/v1/user') {
        const token=req.headers.authorization;
        if (!['Bearer admin-token','Bearer viewer-token'].includes(token)) return json(res,401,{msg:'invalid token'});
        return json(res,200,{id:token==='Bearer admin-token'?'admin-user':'viewer-user',email:'admin@example.com'});
      }
      if (p==='/auth/v1/logout') { res.writeHead(204); res.end(); return; }
      if (p.startsWith('/rest/')) {
        assert.equal(req.headers.apikey,'sb_secret_TEST');
        if (p.endsWith('/central_projects')) {
          let selected=projects.filter(project=>(!url.searchParams.has('id') || url.searchParams.get('id')===`eq.${project.id}`) && (!url.searchParams.has('access_hash') || url.searchParams.get('access_hash')===`eq.${project.access_hash}`) && (!url.searchParams.has('origins') || url.searchParams.get('origins')==='eq.{}' && !project.origins.length));
          if (req.method==='POST') { const input=JSON.parse(await read(req)); projects.push(input); selected=[input]; }
          if (req.method==='PATCH') { const changes=JSON.parse(await read(req)); for (const project of selected) Object.assign(project,changes); }
          if (req.method==='DELETE') for(const project of selected) projects.splice(projects.indexOf(project),1);
          return json(res,200,req.headers.accept?.includes('vnd.pgrst.object') ? selected[0] : selected);
        }
        if (p.endsWith('/central_admins')) return json(res,200,url.searchParams.get('user_id')==='eq.admin-user'?[{user_id:'admin-user'}]:[]);
        if (p.endsWith('/central_report_stats')) return json(res,200,projects.map(project => {
          const list=[...rows.values()].filter(row=>row.ready && row.project_id===project.id);
          return {project_id:project.id,total:list.length,new_count:list.filter(row=>row.status==='novo').length,progress_count:list.filter(row=>['em-analise','em-correcao'].includes(row.status)).length,resolved_count:list.filter(row=>row.status==='resolvido').length};
        }));
        if (p.endsWith('/rpc/central_reserve')) {
          const b=JSON.parse(await read(req)); payloads.push(b.p_report);
          const existing=rows.get(b.p_key);
          if (existing && existing.digest!==b.p_digest) return json(res,400,{code:'P0001',message:'draft_conflict'});
          if (!existing) rows.set(b.p_key,{key:b.p_key,project_id:b.p_project,report:b.p_report,attachments:b.p_attachments,digest:b.p_digest,status:'novo',received_at:new Date().toISOString(),ready:false});
          return json(res,200,[rows.get(b.p_key)]);
        }
        if (p.endsWith('/central_reports')) {
          let selected=[...rows.values()];
          if (url.searchParams.has('key')) { const filter=url.searchParams.get('key'); selected=selected.filter(row=>filter===`eq.${row.key}` || filter.startsWith('in.(') && filter.slice(4,-1).split(',').includes(row.key)); }
          if (url.searchParams.has('project_id')) selected=selected.filter(row=>`eq.${row.project_id}`===url.searchParams.get('project_id'));
          if(url.searchParams.has('limit')) selected=selected.slice(0,Number(url.searchParams.get('limit')));
          if (url.searchParams.has('ready')) selected=selected.filter(row=>`eq.${row.ready}`===url.searchParams.get('ready'));
          if (req.method==='PATCH') {
            const changes=JSON.parse(await read(req));
            if (changes.ready && failCommit) { failCommit=false; return json(res,503,{code:'test_failure',message:'forced commit failure'}); }
            for (const row of selected) Object.assign(row,changes);
          }
          if (req.method==='DELETE') { for(const row of selected) rows.delete(row.key); }
          return json(res,200,selected);
        }
        if (p.endsWith('/central_report_summaries') || p.endsWith('/rpc/central_search')) {
          const query=req.method==='POST'?JSON.parse(await read(req)).p_query.toLowerCase():'';
          const summaries=[...rows.values()].filter(row=>row.ready && (!query || `${row.report.title} ${row.report.description} ${row.project_id}`.toLowerCase().includes(query)))
            .map(row=>({...row,report:{...row.report,title:row.report.title.slice(0,200),description:row.report.description.slice(0,500),links:[]},attachments:[],attachment_count:row.attachments.length,link_count:row.report.links.length}));
          return json(res,200,summaries);
        }
      }
      if (p.startsWith('/storage/v1/')) {
        const suffix=p.replace('/storage/v1','');
        if (suffix.startsWith('/object/upload/sign/central-attachments/')) {
          const key=suffix.split('/central-attachments/')[1];
          if (req.method==='POST') { assert.equal(req.headers.apikey,'sb_secret_TEST'); uploadTokens.add(key); return json(res,200,{url:`${suffix}?token=test-signed-upload`}); }
          assert.ok(uploadTokens.has(key)); assert.equal(url.searchParams.get('token'),'test-signed-upload');
          if (files.has(key)) return json(res,409,{message:'already exists'});
          files.set(key,{bytes:await read(req),type:req.headers['content-type']}); return json(res,200,{Key:key});
        }
        if (suffix.startsWith('/object/info/central-attachments/')) {
          assert.equal(req.headers.apikey,'sb_secret_TEST'); const file=files.get(suffix.split('/central-attachments/')[1]);
          return file?json(res,200,{size:file.bytes.length,content_type:file.type}):json(res,404,{statusCode:'404',error:'not_found',message:'not found'});
        }
        if (suffix==='/object/sign/central-attachments' && req.method==='POST') {
          assert.equal(req.headers.apikey,'sb_secret_TEST'); const body=JSON.parse(await read(req));
          return json(res,200,body.paths.map(key=>({path:key,signedURL:`/object/sign/central-attachments/${key}?token=test-private-read`}))); }
        if (suffix.startsWith('/object/authenticated/central-attachments/') || suffix.startsWith('/object/sign/central-attachments/')) {
          const signed=suffix.startsWith('/object/sign/');
          if (signed) assert.equal(url.searchParams.get('token'),'test-private-read'); else assert.equal(req.headers.apikey,'sb_secret_TEST');
          const file=files.get(suffix.split('/central-attachments/')[1]);
          if (!file) return json(res,404,{message:'missing'});
          res.setHeader('Content-Type',file.type); res.end(req.headers.range?file.bytes.subarray(0,64):file.bytes); return;
        }
        if (suffix==='/object/central-attachments' && req.method==='DELETE') {
          assert.equal(req.headers.apikey,'sb_secret_TEST'); const body=JSON.parse(await read(req));
          if(failDelete) {failDelete=false;return json(res,503,{error:'forced storage failure',message:'forced storage failure'});}
          for (const key of body.prefixes) files.delete(key); return json(res,200,[]);
        }
      }
      const name=p==='/'?'index.html':p.slice(1);
      if (!['index.html','dashboard.js','dashboard.css','cloud.js','central-bugs.js','notifications.js','service-worker.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/badge.png'].includes(name)) return json(res,404,{});
      res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8');
      res.end(await fs.readFile(path.join(output,name)));
    } catch (error) { console.error(error); json(res,500,{error:error.message}); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); origin=`http://127.0.0.1:${server.address().port}`;
  const client=createClient(origin,'sb_secret_TEST',{auth:{persistSession:false,autoRefreshToken:false}});
  handler=createHandler({client,secret:'sb_secret_TEST',centralOrigin:origin,supabaseURL:origin});
  try {
    let unavailable;
    await createHandler()({headers:{}},{setHeader(){},writeHead(status){unavailable=status;},end(){}});
    assert.equal(unavailable,503);
    process.env.SUPABASE_URL='https://central-test.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_TEST'; await build(output);
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_PUBLISHABLE_KEY;
    assert.equal((await fetch(origin+'/api/reports')).status,401);
    assert.equal((await fetch(origin+'/api/reports',{headers:{Authorization:'Bearer viewer-token'}})).status,403);
    assert.equal((await fetch(origin+'/api/reports',{headers:{Authorization:'Bearer invalid'}})).status,401);
    assert.equal((await fetch(origin+'/api/reports',{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).status,403);
    let result=await fetch(origin+'/api/reports',{method:'OPTIONS',headers:{Origin:'https://radarcontratual.com'}}); assert.equal(result.status,204); assert.equal(result.headers.get('Access-Control-Allow-Origin'),'https://radarcontratual.com');
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const page=await browser.newPage(), errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://central-test.supabase.co/**',async route=>{
      const req=route.request(), url=new URL(req.url()); const response=await fetch(origin+url.pathname+url.search,{method:req.method(),headers:req.headers(),...(req.postDataBuffer()?{body:req.postDataBuffer()}:{})});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto(origin); await page.getByRole('heading',{name:'Entre na sua Central'}).waitFor(); assert.equal(await page.locator('#workspace').isVisible(),false);
    await fs.mkdir(path.join(__dirname,'../artifacts'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../artifacts/supabase-login.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1280,height:720});
    assert.equal(await page.locator('[data-central-bugs]').count(),0);
    await page.getByLabel('E-mail',{exact:true}).fill('admin@example.com'); await page.getByLabel('Senha',{exact:true}).fill('test-password'); await page.getByRole('button',{name:'Entrar',exact:true}).click();
    await page.getByRole('button',{name:'Testar o widget'}).waitFor();
    await fs.mkdir(path.join(__dirname,'../artifacts'),{recursive:true});
    await page.getByRole('button',{name:'Testar o widget'}).click(); const widget=page.locator('[data-central-bugs]');
    await widget.getByRole('button',{name:'Relatar um bug'}).click(); await widget.getByLabel('Título',{exact:true}).fill('Teste do envio online');
    const description='Descrição extensa. '.repeat(1000)+'Texto fora da prévia';
    await widget.getByLabel('O que aconteceu?',{exact:true}).fill(description); await widget.getByLabel('Links',{exact:false}).fill('https://example.com/contexto');
    await widget.locator('input[type=file]').setInputFiles([{name:'primeiro.png',mimeType:'image/png',buffer:png},{name:'segundo.png',mimeType:'image/png',buffer:Buffer.concat([png,Buffer.alloc(5*1024*1024)])}]);
    failCommit=true; await widget.getByRole('button',{name:'Enviar relato'}).click(); await widget.getByText(/Seu texto e suas imagens foram preservados/).waitFor();
    assert.equal(await widget.getByLabel('Título',{exact:true}).inputValue(),'Teste do envio online'); assert.equal(files.size,2); assert.equal([...rows.values()].filter(row=>row.ready).length,0);
    await widget.getByRole('button',{name:'Enviar relato'}).click(); await widget.getByText(/Relato salvo na Central/).waitFor();
    assert.equal(rows.size,1); assert.equal(files.size,2); assert.equal(payloads[0].id,payloads[1].id); assert.equal(payloads[0].createdAt,payloads[1].createdAt);
    await widget.getByRole('button',{name:'Fechar',exact:true}).click(); await page.getByRole('button',{name:'Atualizar'}).click(); await page.locator('.occurrence').waitFor();
    assert.ok((await page.locator('.row-meta').innerText()).includes('2 imagem(ns) · 1 link(s)'));
    await page.locator('.occurrence').click(); assert.equal(await page.locator('.description').innerText(),description); await page.locator('.gallery').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>[...document.querySelectorAll('.gallery img')].every(img=>img.naturalWidth>0)); assert.equal(await page.locator('.gallery img').count(),2);
    await page.getByRole('button',{name:'Fechar detalhes'}).click(); await page.getByRole('button',{name:'Resolver ocorrência: Teste do envio online',exact:true}).click();
    await page.getByRole('button',{name:'Ocorrência resolvida: Teste do envio online',exact:true}).waitFor(); assert.equal([...rows.values()][0].status,'resolvido'); assert.equal(await page.locator('#resolved-count').innerText(),'1');
    await page.getByRole('searchbox').fill('Texto fora da prévia'); await page.waitForTimeout(600); assert.equal(await page.locator('.occurrence').count(),1);
    assert.equal(await page.locator('.status-column').count(),4);
    await page.getByRole('button',{name:'Central de Sistemas'}).click();
    await page.getByRole('button',{name:'Cadastrar sistema'}).click();
    await page.getByLabel('Empresa',{exact:true}).fill('Empresa de teste');
    await page.getByLabel('Nome do sistema',{exact:true}).fill('Sistema cadastrado');
    await page.getByLabel('Contas principais autorizadas',{exact:true}).fill('mae@example.com\nsegunda@example.com');
    await page.getByRole('button',{name:'Salvar e gerar ID',exact:true}).click();
    await page.locator('#integration-dialog').waitFor({state:'visible'});
    const accessId=await page.locator('#access-id').innerText(); assert.match(accessId,/^cb_[\w-]{43}$/);
    const registered=projects.find(project=>project.name==='Sistema cadastrado'); assert.ok(registered.restricted);
    assert.ok((await page.locator('#integration-instructions').innerText()).includes('INTEGRACAO-PARA-IA.md'));
    await page.getByRole('button',{name:'Fechar integração'}).click(); await page.waitForFunction(()=>document.querySelector('#access-id').textContent==='');
    await page.getByRole('button',{name:'Editar sistema: Sistema cadastrado'}).click();
    assert.equal(await page.getByLabel('Contas principais autorizadas',{exact:true}).inputValue(),'mae@example.com\nsegunda@example.com');
    await page.getByRole('button',{name:'Fechar cadastro'}).click();
    await page.setViewportSize({width:390,height:844}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(__dirname,'../artifacts/central-sistemas-v06.png'),fullPage:true});
    // A configuração restrita é usada por um endpoint autenticado do próprio SaaS.
    const exchange=async(email,id=accessId,requestOrigin)=>fetch(origin+'/api/reports?widget=access',{method:'POST',headers:{'Content-Type':'application/json',...(requestOrigin?{Origin:requestOrigin}:{})},body:JSON.stringify({accessId:id,email,origin})});
    assert.equal((await exchange('estranho@example.com')).status,403);
    assert.equal((await exchange('mae@example.com',accessId,origin)).status,403);
    assert.equal((await exchange('mae@example.com','cb_'+'x'.repeat(43))).status,403);
    const grant=await (await exchange('MAE@example.com')).json(); assert.equal(grant.projectId,registered.id); assert.equal(grant.user.email,'mae@example.com'); assert.deepEqual(registered.origins,[origin]);
    assert.equal((await exchange('segunda@example.com')).status,200);
    const restrictedReport={...payloads[0],id:'restricted-report',projectId:registered.id,attachments:[],user:{email:'forjado@example.com'}};
    const restrictedPost=async(value,token=grant.token)=>fetch(origin+'/api/reports',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(value)});
    assert.equal((await restrictedPost({action:'prepare',report:restrictedReport},'')).status,403);
    result=await restrictedPost({action:'prepare',report:restrictedReport}); const reserved=await result.json(); assert.equal(result.status,200);
    assert.equal(rows.get(reserved.key).report.user.email,'mae@example.com');
    assert.equal((await restrictedPost({action:'commit',key:reserved.key,receipt:reserved.receipt},'')).status,403);
    assert.equal((await restrictedPost({action:'commit',key:reserved.key,receipt:reserved.receipt})).status,201);
    const adminHeaders={Authorization:'Bearer admin-token','Content-Type':'application/json'};
    for (const [index,status] of ['em-analise','em-correcao','resolvido'].entries()) {
      const sample={...restrictedReport,id:'stage-'+index,title:['Revisar cálculo dos valores','Corrigir filtro de contratos','Atualizar mensagem de confirmação'][index],description:'Relato de teste para conferir a organização das etapas.'};
      const prepared=await (await restrictedPost({action:'prepare',report:sample})).json();
      assert.equal((await restrictedPost({action:'commit',key:prepared.key,receipt:prepared.receipt})).status,201);
      assert.equal((await fetch(origin+'/api/reports/'+prepared.key,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({status})})).status,200);
    }
    const update=async changes=>fetch(origin+'/api/reports?systems=1',{method:'PATCH',headers:adminHeaders,body:JSON.stringify({id:registered.id,name:registered.name,company:registered.company,origins:registered.origins,allowedEmails:['segunda@example.com'],...changes})});
    assert.equal((await update({})).status,200);
    assert.equal((await restrictedPost({action:'prepare',report:{...restrictedReport,id:'removed-account'}})).status,403);
    assert.equal((await exchange('mae@example.com')).status,403);
    const secondGrant=await (await exchange('segunda@example.com')).json();
    const rotated=await (await update({rotateId:true})).json(); assert.ok(rotated.accessId); assert.notEqual(rotated.accessId,accessId);
    assert.equal((await exchange('segunda@example.com')).status,403);
    assert.equal((await restrictedPost({action:'prepare',report:{...restrictedReport,id:'old-ticket'}},secondGrant.token)).status,403);
    const adminList=await (await fetch(origin+'/api/reports?systems=1',{headers:adminHeaders})).json();
    assert.ok(!JSON.stringify(adminList).includes('access_hash')); assert.ok(!JSON.stringify(adminList).includes(rotated.accessId));
    assert.equal((await fetch(origin+'/api/reports?systems=1',{headers:{Authorization:'Bearer viewer-token'}})).status,403);
    // Exclusão sem permissão e falha do Storage deixam a ocorrência intacta.
    const legacyKey=[...rows.values()].find(row=>row.report.title==='Teste do envio online' && row.project_id==='central-demo').key;
    assert.equal((await fetch(origin+'/api/reports/'+legacyKey,{method:'DELETE'})).status,401);
    failDelete=true;
    assert.equal((await fetch(origin+'/api/reports/'+legacyKey,{method:'DELETE',headers:adminHeaders})).status,503);
    assert.ok(rows.has(legacyKey)); assert.equal(files.size,2);
    assert.equal((await fetch(origin+'/api/reports/'+legacyKey,{method:'DELETE',headers:adminHeaders})).status,200);
    assert.equal(rows.has(legacyKey),false); assert.equal(files.size,0);
    await page.getByRole('button',{name:'Ocorrências',exact:false}).filter({hasText:'▦ Ocorrências'}).click();
    await page.getByRole('searchbox').fill(''); await page.getByRole('button',{name:'Atualizar'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.occurrence').length===4);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,'../artifacts/central-blocos-v06.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(__dirname,'../artifacts/central-mobile-v06.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Modo escuro',exact:false}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,'../artifacts/central-escuro-v06.png'),fullPage:true});
    // Sistema inteiro: cancelamento, revogação, anexos de rascunhos, lotes e isolamento.
    const deleteSystem=()=>fetch(origin+'/api/reports?systems=1',{method:'DELETE',headers:adminHeaders,body:JSON.stringify({id:registered.id})});
    assert.equal((await fetch(origin+'/api/reports?systems=1',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:registered.id})})).status,401);
    assert.equal((await fetch(origin+'/api/reports?systems=1',{method:'PATCH',headers:{Authorization:'Bearer viewer-token','Content-Type':'application/json'},body:JSON.stringify({id:registered.id,action:'disconnect'})})).status,403);
    assert.equal((await fetch(origin+'/api/reports?systems=1',{method:'DELETE',headers:adminHeaders,body:JSON.stringify({id:'central-demo'})})).status,404);
    const currentGrant=await (await exchange('segunda@example.com',rotated.accessId)).json();
    const draft=await (await restrictedPost({action:'prepare',report:{...restrictedReport,id:'pending-system-delete',attachments:[{name:'pendente.png',type:'image/png',size:png.length}]}},currentGrant.token)).json();
    assert.equal((await fetch(draft.uploads[0].url,{method:'PUT',headers:{'Content-Type':'image/png'},body:png})).status,200);
    const survivorKey='f'.repeat(64); rows.set(survivorKey,{...rows.get(reserved.key),key:survivorKey,project_id:'central-demo',report:{...restrictedReport,projectId:'central-demo'},attachments:[]});
    const survivor=JSON.stringify(rows.get(survivorKey));
    for(let i=0;i<201;i++){const key=require('node:crypto').createHash('sha256').update('system-batch-'+i).digest('hex');rows.set(key,{...rows.get(reserved.key),key,attachments:[],ready:i%2===0});}
    await page.getByRole('button',{name:'Central de Sistemas',exact:false}).click();
    await page.getByRole('button',{name:'Desconectar sistema: Sistema cadastrado',exact:true}).click();
    assert.equal(await page.locator('#system-action-dialog').isVisible(),true);
    await page.getByRole('button',{name:'Não',exact:true}).click(); assert.ok(registered.access_hash);
    await page.getByRole('button',{name:'Desconectar sistema: Sistema cadastrado',exact:true}).click();
    const beforeDisconnect=rows.size; await page.getByRole('button',{name:'Sim',exact:true}).click();
    await page.locator('#system-action-dialog').waitFor({state:'hidden'}); assert.equal(rows.size,beforeDisconnect);assert.equal(files.size,1);assert.equal(registered.access_hash,null);
    assert.equal((await exchange('segunda@example.com',rotated.accessId)).status,403);
    assert.equal((await restrictedPost({action:'commit',key:draft.key,receipt:draft.receipt},currentGrant.token)).status,403);
    const status=await (await fetch(origin+'/api/reports?widget=status&project='+registered.id,{headers:{Origin:origin}})).json();assert.deepEqual(status,{enabled:false});
    await page.evaluate(id=>{window.disabledWidget=CentralBugs.init({projectId:id,endpoint:'/api/reports',transport:'signed-upload'});},registered.id);
    await page.waitForFunction(id=>!document.querySelector(`[data-central-bugs="${id}"]`),registered.id);
    await page.getByRole('button',{name:'Deletar sistema: Sistema cadastrado',exact:true}).click();
    await page.getByRole('button',{name:'Não',exact:true}).click();assert.equal(rows.size,beforeDisconnect);
    await page.getByRole('button',{name:'Deletar sistema: Sistema cadastrado',exact:true}).click();
    await page.screenshot({path:path.join(__dirname,'../artifacts/central-confirmar-exclusao.png'),fullPage:true});
    failDelete=true; await page.getByRole('button',{name:'Sim',exact:true}).click();
    await page.getByText(/A limpeza pode ter sido parcial/).waitFor();assert.ok(projects.includes(registered));assert.equal(rows.size,beforeDisconnect);assert.equal(files.size,1);
    await page.getByRole('button',{name:'Sim',exact:true}).click();await page.locator('#system-action-dialog').waitFor({state:'hidden'});
    assert.equal(projects.includes(registered),false);assert.equal([...rows.values()].some(row=>row.project_id===registered.id),false);assert.equal(files.size,0);assert.equal(JSON.stringify(rows.get(survivorKey)),survivor);
    assert.equal(await page.getByRole('button',{name:'Editar sistema: Sistema cadastrado',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:/Sistema cadastrado/}).count(),0);
    assert.equal((await deleteSystem()).status,404);
    assert.deepEqual(await (await fetch(origin+'/api/reports?widget=status&project='+registered.id,{headers:{Origin:'https://no-longer-registered.example'}})).json(),{enabled:false});
    await page.screenshot({path:path.join(__dirname,'../artifacts/central-sistemas-v07.png'),fullPage:true});
    await page.goto(origin+'/?notifications=1&systems=radar-contratual');
    await page.getByRole('button',{name:'Testar o widget'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#sync').textContent.startsWith('Atualizado'));
    assert.equal(await page.locator('#page-title').innerText(),'Radar Contratual');
    assert.equal(Number(await page.locator('#total').innerText()),[...rows.values()].filter(row=>row.ready && row.project_id==='radar-contratual').length);
    await page.getByRole('button',{name:/Todos os sistemas/}).click();
    assert.equal(new URL(page.url()).searchParams.has('systems'),false);
    await page.getByRole('button',{name:'Sair',exact:true}).click(); await page.getByRole('heading',{name:'Entre na sua Central'}).waitFor(); assert.equal(await page.locator('[data-central-bugs]').count(),0); assert.equal(await page.locator('.occurrence').count(),0);
    await page.reload(); await page.getByRole('heading',{name:'Entre na sua Central'}).waitFor(); assert.equal(await page.locator('#workspace').isVisible(),false);
    assert.deepEqual(errors,[]);
    const report={...payloads[0],id:'invalid-image',attachments:[{name:'fake.png',type:'image/png',size:5}]};
    const post=async body=>fetch(origin+'/api/reports',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    result=await post({action:'prepare',report}); const prepared=await result.json(); assert.equal(result.status,200);
    await fetch(prepared.uploads[0].url,{method:'PUT',headers:{'Content-Type':'image/png'},body:'fake!'});
    result=await post({action:'commit',key:prepared.key,receipt:prepared.receipt}); assert.equal(result.status,400); assert.equal(rows.get(prepared.key).ready,false); assert.equal(files.has(`${prepared.key}/0`),false);
    assert.equal((await post({action:'commit',key:prepared.key,receipt:'0'.repeat(64)})).status,403);
    assert.equal((await post({action:'prepare',report:{...report,projectId:'radar-contratual'}})).status,403);
    assert.equal((await fetch(origin+'/api/reports/'+[...rows.keys()][0],{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"status":"resolvido"}'})).status,401);
    console.log('OK: login/admin, CORS, upload/retry, detalhes/busca, quatro etapas, cadastro/edição, múltiplas contas, ID secreto/rotação, origem e conta verificadas, exclusão completa e recuperação de falha do Storage, cancelamento Sim/Não, desconexão, exclusão de sistema com mais de 200 registros/pendências e isolamento.');
  } catch(error) {const page=browser?.contexts()[0]?.pages()[0];if(page)console.error(await page.evaluate(()=>({loginHidden:document.querySelector('#login-screen')?.hidden,workspaceHidden:document.querySelector('#workspace')?.hidden,notifications:document.querySelector('#notifications-message')?.textContent})));throw error;}
  finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); await fs.rm(output,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
