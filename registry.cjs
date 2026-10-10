// Compartilhado pelos receptores local e online. IDs de integração ficam no servidor do SaaS.
const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const fail = (status,message) => Object.assign(new Error(message),{status});
const hash = value => createHash('sha256').update(value).digest('hex');
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
function origin(value) {
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw Error();
    return url.origin;
  } catch { throw fail(400,'Informe um domínio HTTPS completo, sem caminho. HTTP é permitido somente em localhost.'); }
}
function fields(input) {
  if (!input || !['name','company'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].trim().length <= 150) ||
    !Array.isArray(input.allowedEmails) || !input.allowedEmails.length || input.allowedEmails.length > 100 ||
    !input.allowedEmails.every(value => email(value).length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value))) ||
    !Array.isArray(input.origins) || input.origins.length > 20) throw fail(400,'Informe empresa, sistema e pelo menos um e-mail válido (até 100 contas).');
  return {name:input.name.trim(),company:input.company.trim(),allowed_emails:[...new Set(input.allowedEmails.map(email))],origins:[...new Set(input.origins.map(origin))],restricted:true};
}
function credential() { const accessId = 'cb_' + randomBytes(32).toString('base64url'); return {accessId,access_hash:hash(accessId)}; }
function create(input) { const {accessId,access_hash}=credential(); return {accessId,project:{id:'sys-'+randomUUID(),...fields(input),access_hash}}; }
function publicProject(project) {
  return {id:project.id,name:project.name,company:project.company || project.name,origins:project.origins,
    allowedEmails:project.allowed_emails || [],restricted:project.restricted === true,connectedAt:project.connected_at || null};
}
function accessInput(input) {
  if (typeof input?.accessId !== 'string' || !/^cb_[\w-]{43}$/.test(input.accessId) || !email(input.email)) throw fail(403,'ID ou conta não autorizados.');
  return {accessHash:hash(input.accessId),email:email(input.email),origin:origin(input.origin)};
}
function authorizeAccount(project, identity) {
  if (!project?.restricted || !project.allowed_emails.includes(identity.email)) throw fail(403,'Esta conta não está autorizada para este sistema.');
  if (project.origins.length && !project.origins.includes(identity.origin)) throw fail(403,'Este domínio não está cadastrado para o sistema.');
}
function ticket(project,identity,secret) {
  const data=Buffer.from(JSON.stringify({project:project.id,integration:project.access_hash,email:identity.email,origin:identity.origin,exp:Date.now()+15*60*1000})).toString('base64url');
  return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
}
function checkTicket(req,project,secret) {
  if (!project?.restricted) return null; // Compatibilidade com instalações anteriores ao cadastro de sistemas.
  try {
    const raw=req.headers.authorization?.match(/^Bearer ([\w-]+\.[\w-]+)$/)?.[1];
    if (!raw || raw.length>2000) throw Error();
    const [data,signature]=raw.split('.'), expected=createHmac('sha256',secret).update(data).digest();
    const actual=Buffer.from(signature,'base64url');
    if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw Error();
    const claims=JSON.parse(Buffer.from(data,'base64url').toString());
    if (claims.project!==project.id || claims.integration!==project.access_hash || claims.origin!==req.headers.origin || !Number.isFinite(claims.exp) || claims.exp<=Date.now()) throw Error();
    authorizeAccount(project,claims); return claims;
  } catch { throw fail(403,'Acesso ao plugin expirado ou conta não autorizada. Entre novamente no seu sistema.'); }
}
module.exports={fail,hash,email,fields,credential,create,publicProject,accessInput,authorizeAccount,ticket,checkTicket};
