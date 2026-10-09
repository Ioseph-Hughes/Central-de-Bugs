// Receptor Vercel: banco/arquivos no Supabase, sem disco ou portas locais.
const { createClient } = require('@supabase/supabase-js');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { validImage } = require('../server.cjs');
const bucket = 'central-attachments';
const states = ['novo','em-analise','em-correcao','resolvido'];
const imageTypes = new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif']);
const fail = (status,message) => Object.assign(new Error(message),{ status });
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (res,status,value) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
const webURL = value => { try { return typeof value === 'string' && ['https:','http:'].includes(new URL(value).protocol); } catch { return false; } };
function validate(report) {
  if (!report || report.schemaVersion !== 1 || typeof report.id !== 'string' || !/^[\w-]{1,128}$/.test(report.id) ||
    !['projectId','title','description'].every(key => typeof report[key] === 'string' && report[key].trim()) ||
    !/^[\w-]{1,100}$/.test(report.projectId) || !['bug','melhoria','ajuste'].includes(report.type) ||
    typeof report.createdAt !== 'string' || !Number.isFinite(Date.parse(report.createdAt)) || !Array.isArray(report.links) || !report.links.every(webURL) ||
    !webURL(report.context?.url) || !Array.isArray(report.attachments) ||
    !report.attachments.every(file => file && typeof file.name === 'string' && file.name && imageTypes.has(file.type) && Number.isSafeInteger(file.size) && file.size > 0)) {
    throw fail(400,'Relato ou metadados das imagens inválidos.');
  }
  if (report.attachments.some(file => file.size > 50 * 1024 * 1024)) throw fail(413,'Cada imagem pode ter até 50 MB neste armazenamento.');
}
async function body(req) {
  // Também limitar antes do parse em execução Node; na Vercel req.body já é parseado.
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > 1024 * 1024) throw fail(413,'Texto e metadados excedem 1 MB por relato.');
    try { return JSON.parse(raw); } catch { throw fail(400,'JSON inválido.'); }
  }
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 1024 * 1024) throw fail(413,'Texto e metadados excedem 1 MB por relato.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400,'JSON inválido.'); }
}
function checked(result) {
  if (result.error) {
    if (result.error.message === 'rate_limit') throw fail(429,'Limite de envios atingido. Aguarde e tente novamente.');
    if (result.error.message === 'draft_conflict') throw fail(409,'O identificador deste relato já está em uso.');
    console.error('Supabase Central:', result.error.code || result.error.name || 'request_failed');
    throw fail(503,'Supabase indisponível ou instalação incompleta. Confira o SQL e as variáveis da Vercel.');
  }
  return result.data;
}
function createHandler({ client, secret, centralOrigin, supabaseURL } = {}) {
  const receipt = row => createHmac('sha256',secret).update(`${row.key}:${row.digest}`).digest('hex');
  async function authorize(req) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw fail(401,'Entre no painel para acessar as ocorrências.');
    const { data,error } = await client.auth.getUser(token);
    if (error || !data?.user) throw fail(401,'Sessão inválida. Entre novamente.');
    const admin = checked(await client.from('central_admins').select('user_id').eq('user_id',data.user.id).maybeSingle());
    if (!admin) throw fail(403,'Este usuário ainda não foi autorizado como administrador.');
  }
  async function publicRecord(row, includeImages = true) {
    // Links expiram; gerar de novo na consulta, sem mudar o fingerprint do painel.
    const attachments = row.attachments.map(file => ({ ...file }));
    if (includeImages && attachments.length) {
      const urls = checked(await client.storage.from(bucket).createSignedUrls(attachments.map(file => file.path),3600));
      for (const [index,file] of attachments.entries()) {
        if (!urls[index]?.signedUrl) throw fail(503,'Não foi possível abrir as imagens desta ocorrência.');
        file.url = urls[index].signedUrl;
      }
    }
    return { key:row.key,report:row.report,attachments,status:row.status,receivedAt:row.received_at,updatedAt:row.updated_at };
  }
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Vary','Origin');
    try {
      if (!client || !secret || !centralOrigin || !supabaseURL) throw fail(503,'Configure SUPABASE_URL, SUPABASE_SECRET_KEY e CENTRAL_ORIGIN na Vercel.');
      const origin = req.headers.origin;
      const projects = checked(await client.from('central_projects').select('id,name,origins'));
      const allowed = origin && (origin === centralOrigin || projects.some(project => project.origins.includes(origin)));
      if (origin && !allowed) throw fail(403,'Domínio não autorizado nesta Central.');
      if (allowed) res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url,'http://localhost');
      const key = req.query?.key || url.searchParams.get('key') || url.pathname.match(/^\/api\/reports\/([a-f0-9]{64})$/)?.[1];
      if (req.method === 'GET') {
        await authorize(req);
        if (url.searchParams.get('access') === 'check') { json(res,200,{authorized:true}); return; }
        if (key) {
          if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw fail(400,'Ocorrência inválida.');
          const row = checked(await client.from('central_reports').select('*').eq('key',key).eq('ready',true).maybeSingle());
          if (!row) throw fail(404,'Ocorrência não encontrada.');
          json(res,200,await publicRecord(row)); return;
        }
        const search = (url.searchParams.get('search') || '').trim();
        if (search.length > 1000) throw fail(400,'Busca muito longa.');
        const query = search ? client.rpc('central_search',{p_query:search}) : client.from('central_report_summaries').select('*');
        const results = await Promise.all([query.order('received_at',{ascending:false}).limit(1000),client.from('central_report_stats').select('*')]);
        const rows = checked(results[0]), stats = checked(results[1]);
        // ponytail: um lote até 1.000 ocorrências; paginar quando o histórico superar este volume.
        // A lista usa resumos; textos completos e links privados das imagens só nos detalhes.
        const reports = []; let length = 0;
        for (const row of rows) {
          const item = {key:row.key,report:row.report,attachments:[],attachmentCount:row.attachment_count,linkCount:row.link_count,status:row.status,receivedAt:row.received_at,updatedAt:row.updated_at};
          length += Buffer.byteLength(JSON.stringify(item)); if (length > 2 * 1024 * 1024) break; reports.push(item);
        }
        json(res,200,{ reports,stats,limited:rows.length===1000 || reports.length<rows.length,projects:projects.map(({id,name}) => ({id,name})) }); return;
      }
      if (req.method === 'PATCH') {
        await authorize(req);
        if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw fail(400,'Ocorrência inválida.');
        const input = await body(req); if (!states.includes(input.status)) throw fail(400,'Status inválido.');
        const row = checked(await client.from('central_reports').update({status:input.status,updated_at:new Date().toISOString()}).eq('key',key).eq('ready',true).select('*').maybeSingle());
        if (!row) throw fail(404,'Ocorrência não encontrada.');
        json(res,200,await publicRecord(row,false)); return;
      }
      if (req.method !== 'POST') throw fail(405,'Método não permitido.');
      if (!origin) throw fail(403,'O envio do widget exige uma origem autorizada.');
      const input = await body(req);
      if (input.action === 'prepare') {
        validate(input.report);
        const report = input.report, project = projects.find(item => item.id === report.projectId);
        if (!project || !(project.origins.includes(origin) || project.id === 'central-demo' && origin === centralOrigin)) throw fail(403,'Sistema ou domínio não autorizado para este envio.');
        if (new URL(report.context.url).origin !== origin) throw fail(400,'Página de origem inválida.');
        const reportKey = hash(JSON.stringify([report.projectId,report.id]));
        const attachments = report.attachments.map((file,index) => ({ name:file.name,type:file.type,size:file.size,path:`${reportKey}/${index}` }));
        const sender = createHmac('sha256',secret).update(`${report.projectId}:${req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}`).digest('hex');
        const rows = checked(await client.rpc('central_reserve',{p_key:reportKey,p_project:project.id,p_report:report,p_attachments:attachments,p_digest:hash(JSON.stringify(report)),p_sender:sender}));
        const row = rows[0]; if (!row) throw fail(503,'Não foi possível reservar o envio.');
        if (row.ready) { json(res,200,{key:row.key,ready:true}); return; }
        const uploads = [];
        for (const file of row.attachments) {
          // Retentativas reutilizam arquivos já recebidos, sem sobrescrever bytes.
          const existing = await client.storage.from(bucket).info(file.path);
          if (!existing.error && existing.data) { uploads.push({uploaded:true}); continue; }
          if (!['404','400'].includes(String(existing.error?.statusCode))) checked(existing);
          const signed = checked(await client.storage.from(bucket).createSignedUploadUrl(file.path,{upsert:false}));
          uploads.push({url:signed.signedUrl});
        }
        json(res,200,{key:row.key,receipt:receipt(row),uploads}); return;
      }
      if (input.action === 'commit') {
        if (typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key) || typeof input.receipt !== 'string' || !/^[a-f0-9]{64}$/.test(input.receipt)) throw fail(400,'Comprovante de envio inválido.');
        const row = checked(await client.from('central_reports').select('*').eq('key',input.key).maybeSingle());
        if (!row || !timingSafeEqual(Buffer.from(receipt(row)),Buffer.from(input.receipt))) throw fail(403,'Comprovante de envio inválido.');
        const project = projects.find(item => item.id === row.project_id);
        if (!project || !(project.origins.includes(origin) || project.id === 'central-demo' && origin === centralOrigin)) throw fail(403,'Origem não autorizada para esta ocorrência.');
        if (!row.ready) {
          for (const file of row.attachments) {
            const info = checked(await client.storage.from(bucket).info(file.path));
            if (Number(info.size) !== file.size || info.contentType !== file.type) {
              checked(await client.storage.from(bucket).remove([file.path]));
              throw fail(400,'Imagem incompleta ou diferente do arquivo informado. Tente enviar novamente.');
            }
            // Verificar os bytes, além do MIME. URL autenticada com Range evita baixar a imagem inteira.
            const response = await fetch(`${supabaseURL}/storage/v1/object/authenticated/${bucket}/${file.path}`,{
              headers:{apikey:secret,Authorization:`Bearer ${secret}`,Range:'bytes=0-63'},signal:AbortSignal.timeout(10000)
            });
            if (!response.ok) throw fail(503,'Não foi possível verificar uma imagem enviada.');
            const reader = response.body.getReader(); let first = Buffer.alloc(0);
            try { while (first.length < 64) { const {value,done} = await reader.read(); if (done) break; first = Buffer.concat([first,Buffer.from(value)]).subarray(0,64); } } finally { await reader.cancel(); }
            if (!validImage(first,file.type)) {
              checked(await client.storage.from(bucket).remove([file.path]));
              throw fail(400,'Um arquivo não corresponde ao formato de imagem. Remova-o ou escolha outra imagem.');
            }
          }
          checked(await client.from('central_reports').update({ready:true}).eq('key',row.key));
        }
        json(res,201,{key:row.key,id:row.report.id}); return;
      }
      throw fail(400,'Ação de envio inválida. Use o widget atualizado com transporte signed-upload.');
    } catch (error) {
      if (!error.status) console.error('Central API:',error.code || error.name);
      json(res,error.status || 503,{error:error.status ? error.message : 'Serviço indisponível. Tente novamente.'});
    }
  };
}
let handler;
module.exports = async (req,res) => {
  try {
    if (!handler) {
      const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
      handler = createHandler({client:url && secret ? createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}) : null,
        secret,centralOrigin:process.env.CENTRAL_ORIGIN,supabaseURL:url});
    }
    return await handler(req,res);
  } catch { json(res,503,{error:'Configuração inválida do Supabase. Confira as variáveis da Vercel.'}); }
};
module.exports.createHandler = createHandler;
