// PostgreSQL embarcado para conferir a instalação/permissões sem tocar no Supabase real.
// npm install --prefix /tmp/central-sql-check @electric-sql/pglite
// PGLITE_PATH=/tmp/central-sql-check/node_modules/@electric-sql/pglite node tests/sql.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  try {
    await db.exec('create schema auth; create table auth.users(id uuid primary key,email text); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create role anon; create role authenticated; create role service_role bypassrls;');
    const sql = await fs.readFile(path.join(__dirname,'../supabase/setup.sql'),'utf8');
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query('select public from storage.buckets')).rows[0].public,false);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.central_reports'),/permission denied/);
      await assert.rejects(db.query('select * from public.central_report_summaries'),/permission denied/);
      await assert.rejects(db.query('select * from public.central_admins'),/permission denied/);
      await assert.rejects(db.query("select * from public.central_reserve('a','central-demo','{}','[]','x','ip')"),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const key = index => createHash('sha256').update(String(index)).digest('hex');
    const report={id:'report-id',title:'Teste',description:'Descrição extensa '+'a'.repeat(600)+' buscar no final',type:'bug',links:['https://example.com']};
    const reserve = (index,digest='same') => db.query('select * from public.central_reserve($1,$2,$3,$4,$5,$6)',[key(index),'central-demo',JSON.stringify(report),'[]',digest,'sender']);
    const saved=(await reserve(1)).rows[0]; assert.equal(saved.ready,false); await reserve(1); assert.equal((await db.query('select count(*)::int as n from public.central_reports')).rows[0].n,1);
    await assert.rejects(reserve(1,'different'),/draft_conflict/);
    for (let index=2;index<=20;index++) await reserve(index);
    await assert.rejects(reserve(21),/rate_limit/);
    await db.query('update public.central_reports set ready=true where key=$1',[key(1)]);
    const summary=(await db.query('select * from public.central_report_summaries')).rows[0]; assert.equal(summary.report.description.length,500); assert.equal(summary.link_count,1);
    assert.equal((await db.query('select * from public.central_search($1)',['buscar no final'])).rows.length,1);
    await db.exec('reset role');
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='central_reports'")).rows[0].relrowsecurity,true);
    console.log('OK: SQL executado duas vezes, tabelas e view privadas, RPC reservado ao servidor, quotas, deduplicação/conflito, resumos e busca no texto completo em PostgreSQL.');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
