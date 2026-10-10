// Identidades controladas pelo servidor de teste; não acessa contas ou dados reais.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {createCentralServer}=require('../server.cjs');
const registry=require('../registry.cjs');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>server.close(resolve));
(async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'central-registry-'));
  let server,saas,browser;
  try {
    const allowedOrigins=[]; server=await createCentralServer({dataDir,allowedOrigins}); let central=await listen(server); allowedOrigins.push(central);
    const manage=async(input,method='POST')=>fetch(central+'/api/reports?systems=1',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const input={company:'Grupo de teste',name:'Sistema A',allowedEmails:[' MAE@example.com ','segunda@example.com'],origins:[]};
    assert.equal((await manage({...input,allowedEmails:[]})).status,400);
    assert.equal((await manage({...input,origins:['https://site.example/caminho']})).status,400);
    const created=await (await manage(input)).json(), second=await (await manage({...input,name:'Sistema B'})).json();
    assert.deepEqual(created.project.allowedEmails,['mae@example.com','segunda@example.com']);
    let saasOrigin;
    saas=http.createServer(async(req,res)=>{
      if(req.url==='/api/central-bugs/access') {
        // O endpoint determina a identidade pela sessão de teste; ignora email vindo do navegador.
        const identity=/account=(mae|segunda|estranha)/.exec(req.headers.cookie || '')?.[1];
        if(!identity){res.writeHead(401);res.end('{}');return;}
        const response=await fetch(central+'/api/reports?widget=access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessId:created.accessId,email:identity+'@example.com',origin:saasOrigin})});
        res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await response.text());return;
      }
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><title>SaaS de teste</title><script src="${central}/central-bugs.js"></script></head><body><h1>SaaS de teste</h1><script>window.lifecycle=new AbortController();window.ready=CentralBugs.connect({accessEndpoint:'/api/central-bugs/access',signal:lifecycle.signal}).then(widget=>window.feedback=widget);</script></body></html>`);
    });saasOrigin=await listen(saas);
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    async function account(name){await context.clearCookies();if(name)await context.addCookies([{name:'account',value:name,url:saasOrigin}]);await page.goto(saasOrigin);await page.evaluate(()=>window.ready);}
    await account(null);assert.equal(await page.locator('[data-central-bugs]').count(),0);
    await account('estranha');assert.equal(await page.locator('[data-central-bugs]').count(),0);
    await account('mae');assert.equal(await page.locator('[data-central-bugs]').count(),1);
    const widget=page.locator('[data-central-bugs]');
    await widget.locator('.launch').click();await widget.getByRole('button',{name:'Relatar um bug'}).click();await widget.getByLabel('Título',{exact:true}).fill('Número faltando na variável');await widget.getByLabel('O que aconteceu?',{exact:true}).fill('O valor do contrato aparece incompleto.');
    await widget.locator('input[type=file]').setInputFiles({name:'recorte.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64')});
    await widget.getByRole('button',{name:'Enviar relato'}).click();await widget.getByText(/Relato enviado/).waitFor();
    const list=await (await fetch(central+'/api/reports')).json(),record=list.reports[0];assert.equal(record.report.projectId,created.project.id);assert.equal(record.report.user.email,'mae@example.com');
    // Logout enquanto o rascunho está aberto encerra o widget, sem deixar captura/formulário.
    await page.evaluate(()=>window.lifecycle.abort());assert.equal(await page.locator('[data-central-bugs]').count(),0);
    await account('segunda');assert.equal(await page.locator('[data-central-bugs]').count(),1);
    await widget.locator('.launch').click();await widget.getByRole('button',{name:'Sugerir uma melhoria'}).click();await widget.getByLabel('Título',{exact:true}).fill('Melhoria de filtro');await widget.locator('textarea[name=description]').fill('Adicionar busca por cliente.');
    // Revogação antes de enviar não expõe o plugin nem persiste um relato não autorizado.
    assert.equal((await manage({...input,id:created.project.id,origins:[saasOrigin],allowedEmails:['mae@example.com']},'PATCH')).status,200);
    await widget.getByRole('button',{name:'Enviar relato'}).click();await page.waitForFunction(()=>!document.querySelector('[data-central-bugs]'));
    assert.equal((await (await fetch(central+'/api/reports')).json()).reports.length,1);
    const dashboard=await context.newPage({viewport:{width:1440,height:1000}});dashboard.on('dialog',dialog=>dialog.accept());await dashboard.goto(central);await dashboard.locator('.occurrence').waitFor();
    assert.equal(await dashboard.locator('.system-group').count(),1);assert.equal(await dashboard.locator('.status-column').count(),4);
    await dashboard.getByRole('button',{name:'Analisar ocorrência: Número faltando na variável',exact:true}).click();await dashboard.locator('.em-analise .occurrence').waitFor();
    await dashboard.getByRole('button',{name:'Processar ocorrência: Número faltando na variável',exact:true}).click();await dashboard.locator('.em-correcao .occurrence').waitFor();
    await dashboard.getByRole('button',{name:'Resolver ocorrência: Número faltando na variável',exact:true}).click();await dashboard.locator('.resolvido .occurrence').waitFor();
    await dashboard.getByRole('button',{name:'Apagar bugs antigos',exact:true}).click();await dashboard.locator('#delete-before').fill('2099-01-01');await dashboard.locator('#delete-before').dispatchEvent('change');
    assert.equal(await dashboard.locator('.delete-option').count(),1);await dashboard.getByRole('button',{name:'Apagar selecionados',exact:true}).click();await dashboard.getByText('Apagadas 1 de 1.',{exact:true}).waitFor();
    assert.equal((await (await fetch(central+'/api/reports')).json()).reports.length,0);
    assert.equal((await fetch(central+record.attachments[0].url)).status,404);await assert.rejects(fs.stat(path.join(dataDir,record.key)),{code:'ENOENT'});
    assert.ok((await (await fetch(central+'/api/reports?systems=1')).json()).projects.some(project=>project.id===second.project.id));
    await close(server);server=await createCentralServer({dataDir,allowedOrigins});central=await listen(server);allowedOrigins.push(central);
    assert.equal((await (await fetch(central+'/api/reports')).json()).reports.length,0);
    assert.equal((await (await fetch(central+'/api/reports?systems=1')).json()).projects.length,3);
    assert.equal((await fetch(central+'/data/systems.json')).status,404);
    const project=registry.create(input).project,identity={email:'mae@example.com',origin:saasOrigin},secret='test-only';project.origins=[saasOrigin];
    const token=registry.ticket(project,identity,secret),req={headers:{origin:saasOrigin,authorization:'Bearer '+token}};
    assert.equal(registry.checkTicket(req,project,secret).email,identity.email);
    const now=Date.now;try{Date.now=()=>now()+16*60*1000;assert.throws(()=>registry.checkTicket(req,project,secret),/expirado/);}finally{Date.now=now;}
    assert.throws(()=>registry.checkTicket({headers:{...req.headers,origin:'https://outro.example'}},project,secret),/expirado/);
    assert.deepEqual(errors,[]);
    console.log('OK: conexão por sessão do SaaS, duas contas permitidas, conta bloqueada, logout/revogação, etapas por empresa, exclusão por data com anexos e persistência, tickets com validade e domínio.');
  }finally{await browser?.close();if(saas)await close(saas);if(server)await close(server);await fs.rm(dataDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
