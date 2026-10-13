// Publicações simuladas em outra origem. Não modifica nenhum SaaS/registro real.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const stop=server=>new Promise(resolve=>server.close(resolve));
(async()=>{
  const source=await fs.readFile(path.join(__dirname,'../central-bugs.js'),'utf8');
  const versions=['a','b','c','d','e'].map(letter=>letter.repeat(64));
  let published=versions[0],protocol=1,failScript=false,delayScript=false,releaseScript,active=true,browser,central,saas,downloads=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/central-bugs-version.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({protocol,release:published}));return;}
    if(url.pathname==='/api/reports'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled:active}));return;}
    if(url.pathname==='/central-bugs.js'){
      const target=url.searchParams.get('cb-release') || published;
      const send=()=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');if(failScript){res.writeHead(503);res.end();}else res.end(source.replace('__CENTRAL_BUGS_RELEASE__',target));};
      if(url.searchParams.has('cb-release'))downloads++;
      if(delayScript){releaseScript=send;return;}send();return;
    }
    res.writeHead(404);res.end();
  });
  central=await listen(server);
  const app=http.createServer((req,res)=>{
    if(req.url==='/api/central-bugs/access'){
      res.setHeader('Content-Type','application/json');
      if(!req.headers.cookie?.includes('account=allowed')){res.writeHead(403);res.end('{}');return;}
      res.end(JSON.stringify({projectId:'registered-system',endpoint:central+'/api/reports',transport:'multipart',user:{email:'allowed@example.com'},token:'fixture-ticket'}));return;
    }
    const auto=req.url==='/auto',registered=req.url==='/registered';
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SaaS · atualização isolada</title><script src="${central}/central-bugs.js"${auto?' data-project-id="auto-system" data-endpoint="'+central+'/api/reports"':''}></script></head><body style="background:#e9eee9"><h1>SaaS de teste</h1><p>O tema deste sistema permanece independente do plugin.</p><script>
      window.lifecycle=new AbortController();
      window.ready=${auto?"new Promise(resolve=>document.addEventListener('DOMContentLoaded',()=>resolve(CentralBugs.instance),{once:true}))":registered?"CentralBugs.connect({accessEndpoint:'/api/central-bugs/access',signal:lifecycle.signal})":`Promise.resolve(CentralBugs.init({projectId:'legacy-system',endpoint:'${central}/api/reports',transport:'multipart',onSubmit:({report,files})=>{window.lastReport=report;window.lastFiles=files;return new Promise(resolve=>window.finishSend=resolve);}}))`};
      ready.then(widget=>window.stable=widget);
    </script></body></html>`);
  });saas=await listen(app);
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.install();await page.goto(saas);await page.evaluate(()=>window.ready);
    const widget=page.locator('[data-central-bugs]'),initialBackground=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
    await page.evaluate(()=>{window.originalHandle=stable;window.originalAPI=CentralBugs;stable.setPosition('top-left');});
    published=versions[1];await page.clock.runFor(60010);await page.waitForFunction(version=>stable.version===version,versions[1]);
    assert.equal(await page.evaluate(()=>stable===originalHandle && CentralBugs===originalAPI),true);assert.equal(await widget.count(),1);
    assert.equal(await widget.locator('.launcher').getAttribute('data-edge'),'left');
    await page.evaluate(()=>stable.open());await widget.getByRole('button',{name:'Relatar um bug'}).click();
    assert.equal(await widget.locator('[name=links]').count(),0);
    await widget.getByRole('button',{name:'Ativar modo escuro',exact:true}).click();assert.equal(await widget.getAttribute('data-theme'),'dark');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),initialBackground);
    await widget.getByLabel('Título',{exact:true}).fill('Rascunho protegido');await widget.getByLabel('O que aconteceu?',{exact:true}).fill('Texto e imagem devem permanecer.');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
    await widget.locator('input[type=file]').setInputFiles({name:'evidencia.png',mimeType:'image/png',buffer:png});
    published=versions[2];await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(await page.evaluate(()=>stable.version),versions[1]);
    await widget.getByRole('button',{name:'Fechar',exact:true}).click();await page.evaluate(()=>CentralBugs.checkForUpdates());
    assert.equal(await page.evaluate(()=>stable.version),versions[1],'Fechar um rascunho não permite descartá-lo para atualizar');
    await page.evaluate(()=>stable.open());assert.equal(await widget.getByLabel('Título',{exact:true}).inputValue(),'Rascunho protegido');assert.equal(await widget.locator('.attachment').count(),1);
    await widget.getByRole('button',{name:'Enviar relato'}).click();await page.waitForFunction(()=>typeof finishSend==='function');
    await page.evaluate(()=>stable.close());await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(await page.evaluate(()=>stable.version),versions[1]);
    assert.equal(await page.evaluate(()=>lastReport.projectId),'legacy-system');assert.deepEqual(await page.evaluate(()=>lastReport.links),[]);assert.equal(await page.evaluate(()=>lastFiles.length),1);
    await page.evaluate(()=>finishSend());await page.waitForFunction(version=>stable.version===version,versions[2]);
    assert.equal(await widget.getAttribute('data-theme'),'dark');assert.equal(await widget.count(),1);
    await page.evaluate(()=>stable.open());await fs.mkdir(path.join(__dirname,'../artifacts/widget-v09'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../artifacts/widget-v09/escuro.png'),fullPage:true});
    await widget.getByRole('button',{name:'Ativar modo claro',exact:true}).click();await page.screenshot({path:path.join(__dirname,'../artifacts/widget-v09/claro.png'),fullPage:true});
    await widget.getByRole('button',{name:'Fechar',exact:true}).click();
    published=versions[3];failScript=true;await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(await page.evaluate(()=>stable.version),versions[2]);assert.equal(await widget.count(),1);
    failScript=false;protocol=2;const before=downloads;await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(downloads,before,'Protocolo incompatível não carrega código');
    protocol=1;await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(await page.evaluate(()=>stable.version),versions[3]);
    published=versions[4];await page.evaluate(()=>{const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="script-src 'none'";document.head.append(meta);});
    await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(await page.evaluate(()=>stable.version),versions[3]);assert.equal(await widget.count(),1);
    await page.evaluate(()=>stable.destroy());assert.equal(await widget.count(),0);
    // Tag automática: a referência CentralBugs.instance continua utilizável.
    published=versions[0];await page.goto(saas+'/auto');await page.evaluate(()=>window.ready);published=versions[1];await page.evaluate(()=>CentralBugs.checkForUpdates());
    assert.equal(await page.evaluate(()=>CentralBugs.instance===stable && stable.version),versions[1]);await page.evaluate(()=>stable.destroy());
    // Conta autorizada: atualizar não repete cadastro nem troca identidade. Logout durante download não remonta.
    published=versions[0];await context.addCookies([{name:'account',value:'allowed',url:saas}]);await page.goto(saas+'/registered');await page.evaluate(()=>window.ready);
    assert.equal(await widget.count(),1);published=versions[1];await page.evaluate(()=>CentralBugs.checkForUpdates());assert.equal(await page.evaluate(()=>stable.version),versions[1]);
    published=versions[4];delayScript=true;await page.evaluate(()=>{window.pendingUpdate=CentralBugs.checkForUpdates();});
    for(let i=0;i<100 && !releaseScript;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releaseScript);
    await page.evaluate(()=>lifecycle.abort());assert.equal(await widget.count(),0);delayScript=false;releaseScript();await page.evaluate(()=>pendingUpdate);
    assert.equal(await widget.count(),0);await page.evaluate(()=>stable.open());assert.equal(await widget.count(),0);
    await context.clearCookies();await page.reload();await page.evaluate(()=>window.ready);assert.equal(await widget.count(),0);
    assert.deepEqual(errors,[]);console.log('OK: atualização entre origens/por intervalo, referências estáveis, rascunho fechado e anexos preservados, envio protegido, tema persistido, tag, connect, falha/CSP, protocolo e logout durante download.');
  }finally{await browser?.close();await stop(app);await stop(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
