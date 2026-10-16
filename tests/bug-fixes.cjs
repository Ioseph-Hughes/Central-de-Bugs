// GitHub/OpenAI simulados; SQL real em PostgreSQL embarcado. Não usa contas externas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { generateKeyPairSync, verify, createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const {validateRequest,sanitize,proposal,createIntegration} = require('../bug-fixes.cjs');
const {validateProposal,allowedPath,applyProposal,gate,publish,requiredChecks} = require('../scripts/bugfix-workflow.cjs');
const root=path.resolve(__dirname,'..');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const report={schemaVersion:1,id:'one',projectId:'central-demo',type:'bug',autoFix:true,title:'Falha ao salvar',description:'Senha: super-secreta\nContato: pessoa@example.com',
  diagnostics:{steps:'Clicar em salvar',expected:'Salvar',observed:'Erro',logs:'Authorization: Bearer hidden-token\napi_key="another-secret"'},context:{url:'https://example.com/form?token=secreto#privado',pageTitle:'Formulário'},attachments:[],links:[]};
(async()=>{
  assert.throws(()=>validateRequest({...report,autoFix:'true'}));
  assert.throws(()=>validateRequest({...report,type:'ajuste'}));
  assert.throws(()=>validateRequest({...report,diagnostics:{logs:3}}));
  assert.throws(()=>validateRequest({...report,diagnostics:{repository:'evil/repo'}}));
  validateRequest(report); validateRequest({...report,autoFix:false});
  const clean=JSON.stringify(proposal({...report,user:{email:'private@example.com'},links:['https://private.example/token']}));
  for(const value of ['super-secreta','pessoa@example.com','hidden-token','another-secret','?token','private@example.com','private.example']) assert.ok(!clean.includes(value),value);
  assert.doesNotMatch(sanitize('password="abc" token=def cookie: SESSION=ghi\nhttps://user:pass@example.com/page?secret=a#b\n192.168.1.1\n123.456.789-10\n@everyone'),/abc|def|SESSION|user:pass|secret=a|192\.168|123\.456|@everyone/);
  assert.equal(sanitize('-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----'),'[CHAVE REMOVIDA]');
  assert.doesNotMatch(sanitize('{"Cookie":"session=private-cookie"}\nsessionToken=private-session'),/private-cookie|private-session/);
  assert.equal(sanitize('-----BEGIN PRIVATE KEY-----\n'+'sensitive'.repeat(10000)),'[CHAVE REMOVIDA]');
  assert.ok(JSON.stringify(proposal({...report,description:'\n'.repeat(24000),diagnostics:{steps:'a'.repeat(12000),expected:'b'.repeat(12000),observed:'c'.repeat(12000),logs:'`'.repeat(12000)}})).length<=48000);
  assert.doesNotMatch(sanitize('sk-abcdefghijklmnop github_pat_abcdefghijk eyJhbGciOiJIUzI1NiJ9.e30.signature'),/abcdefghijklmnop|github_pat_|eyJ/);
  const db=new PGlite();
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'central-bugfix-'));
  const savedCwd=process.cwd(), savedFetch=global.fetch, savedEnv={...process.env};
  try {
    await db.exec('create schema auth; create table auth.users(id uuid primary key,email text); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(fs.readFileSync(path.join(root,'supabase/setup.sql'),'utf8'));
    const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261015204835_automated_bug_fixes.sql'),'utf8');
    await db.exec(migration); await db.exec(migration);
    for(const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      await assert.rejects(db.query('select * from public.central_bug_fix_jobs'),/permission denied/);
      await assert.rejects(db.query("select * from public.central_claim_bug_fix('x','test/repo','x')"),/permission denied/);
      await db.exec('reset role');
    }
    const client={
      async rpc(name,args) {
        assert.equal(name,'central_claim_bug_fix');
        try { return {data:(await db.query('select * from public.central_claim_bug_fix($1,$2,$3)',[args.p_key,args.p_repository,args.p_fingerprint])).rows}; }
        catch(error) {return {error};}
      },
      from(table) {
        assert.equal(table,'central_bug_fix_jobs');
        let updates,filter,limit=100;
        const query={update(value){updates=value;return query;},select(){return query;},eq(key,value){assert.ok(['fingerprint','report_key'].includes(key));filter=[key,value];return query;},limit(n){limit=n;return query;},
          then(resolve,reject){
            const run=async()=>{
              if(updates){const keys=Object.keys(updates);assert.ok(keys.every(k=>['state','issue_number'].includes(k)));return {data:(await db.query(`update public.central_bug_fix_jobs set ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} where ${filter[0]}=$${keys.length+1} returning *`,[...Object.values(updates),filter[1]])).rows};}
              return {data:(await db.query(`select * from public.central_bug_fix_jobs where ${filter[0]}=$1 limit $2`,[filter[1],limit])).rows};
            }; return run().then(resolve,reject);
          }};
        return query;
      }
    };
    const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    const env={BUGFIX_REPOSITORIES:JSON.stringify({'central-demo':{repository:'test/repo',installationId:'1'}}),BUGFIX_APP_ID:'1',BUGFIX_APP_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'})};
    const calls=[];let failAt='',issueId=100;
    const request=async(url,options)=>{
      calls.push({url,options});
      assert.ok(url.startsWith('https://api.github.com/'));
      if(failAt && failAt!=='timeout' && url.endsWith(failAt)) return Response.json({}, {status:503});
      if(url.endsWith('/access_tokens')) {
        const jwt=options.headers.Authorization.slice(7),[head,payload,sig]=jwt.split('.');
        assert.ok(verify('RSA-SHA256',Buffer.from(head+'.'+payload),publicKey,Buffer.from(sig,'base64url')));
        assert.deepEqual(JSON.parse(options.body),{repositories:['repo'],permissions:{issues:'write'}});
        return Response.json({token:'test-installation-token'});
      }
      if(failAt==='timeout' && url.endsWith('/issues')) throw Error('timeout after GitHub may have accepted');
      if(url.endsWith('/issues')) {const body=JSON.parse(options.body);assert.deepEqual(body.labels,['bug']);assert.ok(!body.body.includes('another-secret'));return Response.json({number:issueId++});}
      assert.ok(url.endsWith('/labels'));assert.deepEqual(JSON.parse(options.body),{labels:['codex-fix']});
      return Response.json([]);
    };
    const integration=createIntegration({client,env,request});
    async function rowFor(id,changes={}) {
      const r={...report,id,...changes},key=hash(id);
      const row={key,project_id:r.projectId,report:r,ready:true};
      await db.query('insert into public.central_reports(key,project_id,report,digest,sender_hash,ready) values($1,$2,$3,$4,$5,true)',[key,r.projectId,JSON.stringify(r),hash(id),'sender']);
      return row;
    }
    const row=await rowFor('one');
    const outcomes=await Promise.all([integration.start(row),integration.start(row)]);
    assert.ok(outcomes.some(o=>o.state==='queued'));assert.equal(calls.filter(c=>c.url.endsWith('/issues')).length,1);
    assert.equal((await integration.status(row)).state,'queued');
    const duplicate=await rowFor('duplicate');
    assert.equal((await integration.start(duplicate)).issueURL,'https://github.com/test/repo/issues/100');
    assert.equal(calls.filter(c=>c.url.endsWith('/issues')).length,1);
    assert.equal((await integration.status(duplicate)).state,'queued');
    assert.equal(await integration.start({report:{...report,autoFix:false}}),undefined);
    assert.equal((await createIntegration({client,env:{},request}).start(row)).state,'unavailable');
    failAt='timeout';
    const uncertain=await rowFor('timeout',{title:'Timeout GitHub'});
    assert.equal((await integration.start(uncertain)).state,'uncertain');
    const before=calls.length;await integration.start(uncertain);assert.equal(calls.length,before);
    failAt='/access_tokens';
    assert.equal((await integration.start(await rowFor('failed',{title:'Falha API'}))).state,'failed');
    failAt='';
    await integration.start(await rowFor('four',{title:'Quarta correção'}));
    await integration.start(await rowFor('five',{title:'Quinta correção'}));
    const limited=await integration.start(await rowFor('six',{title:'Sexta correção'}));
    assert.equal(limited.state,'unavailable');assert.match(limited.message,/limite diário/);
    // Registros não confirmados nunca podem obter reserva de correção.
    await db.query('update public.central_reports set ready=false where key=$1',[row.key]);
    await assert.rejects(db.query('select * from public.central_claim_bug_fix($1,$2,$3)',[row.key,'test/repo',hash('invalid')]),/invalid_report/);

    // Patch real em repositório descartável: permitido, protegido, travessia e symlink.
    process.chdir(temp);
    const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com');
    fs.writeFileSync('app.js','module.exports = 1;\n');
    fs.mkdirSync('tests');fs.writeFileSync('tests/existing.cjs','require("node:assert").ok(true);\n');
    git('add','.');git('commit','-qm','base');
    const base=git('rev-parse','HEAD').trim();
    fs.writeFileSync('app.js','module.exports = 2;\n');
    const patch=git('diff');git('checkout','--','app.js');
    const p={status:'fixed',summary:'Corrige o valor; teste local executado.',patch};
    assert.equal(applyProposal(p,path.join(temp,'change.patch')),1);
    assert.match(fs.readFileSync('app.js','utf8'),/= 2/);git('reset','--hard','HEAD');
    assert.throws(()=>validateProposal({...p,status:'blocked'}));
    assert.throws(()=>validateProposal({...p,patch:'a'.repeat(180001)}));
    for(const file of ['../app.js','.github/workflows/test.yml','AGENTS.md','CLAUDE.md','package.json','registry.cjs','bug-fixes.cjs','scripts/build.cjs','supabase/setup.sql','tests/existing.cjs','api/../../oops.js']) assert.equal(allowedPath(file,true),false,file);
    assert.equal(allowedPath('tests/codex-saving.cjs',false),true);
    assert.throws(()=>applyProposal({...p,patch:patch.replaceAll('app.js','scripts/build.cjs')},path.join(temp,'blocked.patch')),/protegido/);
    assert.throws(()=>applyProposal({...p,patch:'diff --git a/link.js b/link.js\nnew file mode 120000\nindex 0000000..0000000\n--- /dev/null\n+++ b/link.js\n@@ -0,0 +1 @@\n+outside\n'},path.join(temp,'link.patch')),/especial/);

    // Gate e publicação exercitam a API simulada; só o push usa um bare repo temporário.
    const remote=path.join(temp,'remote.git');git('init','--bare','-q',remote);git('remote','add','origin',remote);
    Object.assign(process.env,{GITHUB_REPOSITORY:'test/repo',GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1',BUGFIX_BOT_LOGIN:'central-test[bot]',GITHUB_OUTPUT:path.join(temp,'output'),GITHUB_EVENT_PATH:path.join(temp,'event.json'),RUNNER_TEMP:temp,ISSUE_NUMBER:'7',GH_TOKEN:'test-only'});
    const event={action:'labeled',label:{name:'codex-fix'},sender:{login:'central-test[bot]'},issue:{number:7,user:{login:'central-test[bot]'}}};
    fs.writeFileSync(process.env.GITHUB_EVENT_PATH,JSON.stringify(event));
    const githubCalls=[];let attempted=false;
    global.fetch=async(url,options)=>{
      githubCalls.push({url,options});const body=options.body&&JSON.parse(options.body);
      if(url.endsWith('/issues/7') && options.method==='GET')return Response.json({number:7,user:{login:'central-test[bot]'},state:'open',title:'Bug',body:'<!-- central-bug-fix:'+hash('trusted')+' -->',labels:[{name:'bug'},{name:'codex-fix'}]});
      if(url.includes('/comments?'))return Response.json(attempted?[{user:{login:'github-actions[bot]'},body:'<!-- central-codex-attempt -->'}]:[]);
      if(url.includes('matching-refs') || url.includes('/pulls?'))return Response.json([]);
      if(url.endsWith('/comments')){attempted=true;return Response.json({});}
      if(url==='https://api.github.com/repos/test/repo')return Response.json({default_branch:'main'});
      if(url.endsWith('/pulls')){assert.equal(body.draft,true);assert.equal(body.base,'main');assert.match(body.body,/Closes #7/);return Response.json({number:8,html_url:'https://github.com/test/repo/pull/8'});}
      if(url.endsWith('/issues/8/labels')){assert.deepEqual(body.labels,['codex-generated']);return Response.json([]);}
      throw Error('Unexpected API '+url);
    };
    await gate();assert.match(fs.readFileSync(process.env.GITHUB_OUTPUT,'utf8'),/issue=7/);
    await assert.rejects(gate(),/tentativa/);
    fs.writeFileSync(process.env.GITHUB_EVENT_PATH,JSON.stringify({...event,sender:{login:'outsider'}}));
    await assert.rejects(gate(),/não autorizado/);
    fs.mkdirSync('validated');fs.writeFileSync('validated/proposal.json',JSON.stringify(p));
    fs.writeFileSync('validated/verification.json',JSON.stringify({base,checks:requiredChecks,result:'failed',run:'42'}));
    await assert.rejects(publish(),/Verificação ausente/);
    fs.writeFileSync('validated/verification.json',JSON.stringify({base,checks:requiredChecks,result:'passed',run:'42'}));
    await publish();
    assert.match(git('--git-dir='+remote,'show','refs/heads/codex/issue-7:app.js'),/= 2/);
    assert.equal(git('--git-dir='+remote,'branch','--list','main').trim(),'');
    assert.ok(!githubCalls.some(c=>/merges|deployments|releases/.test(c.url)));
    console.log('OK: sanitização, JWT do App, SQL privado/idempotente, concorrência, deduplicação, quotas, falhas ambíguas, gate, patch protegido e publicação de PR draft simulada após verificação.');
  } finally {
    global.fetch=savedFetch;process.chdir(savedCwd);
    for(const key of Object.keys(process.env))if(!Object.hasOwn(savedEnv,key))delete process.env[key];
    Object.assign(process.env,savedEnv);await db.close();fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
