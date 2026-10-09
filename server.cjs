// Painel e receptor local compartilham a mesma caixa de entrada em disco.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = __dirname;
const states = ['novo', 'em-analise', 'em-correcao', 'resolvido'];
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const webURL = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const keyFor = report => createHash('sha256').update(JSON.stringify([report.projectId, report.id])).digest('hex');
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
function validate(report, files) {
  if (!report || report.schemaVersion !== 1 || typeof report.id !== 'string' || !/^[\w-]{1,128}$/.test(report.id) ||
    !['projectId', 'title', 'description'].every(key => typeof report[key] === 'string' && report[key].trim()) ||
    !['bug', 'melhoria', 'ajuste'].includes(report.type) || !Number.isFinite(Date.parse(report.createdAt)) ||
    !Array.isArray(report.links) || !report.links.every(url => typeof url === 'string' && webURL(url)) ||
    !Array.isArray(report.attachments) || report.attachments.length !== files.length ||
    !files.every(file => typeof file.arrayBuffer === 'function' && imageTypes.has(file.type) && file.size > 0)) {
    throw Object.assign(new Error('Relato ou imagens inválidos.'), { status: 400 });
  }
}
function validImage(bytes, type) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return bytes.length >= 16 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' &&
    /avif|avis/.test(bytes.subarray(8, Math.min(bytes.readUInt32BE(0), bytes.length)).toString('ascii'));
}
async function createCentralServer({ dataDir = path.join(root, 'data'), allowedOrigins = [
  'http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:4180', 'http://127.0.0.1:4180'
] } = {}) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const records = new Map();
  for (const name of await fs.readdir(dataDir)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const record = JSON.parse(await fs.readFile(path.join(dataDir, name, 'report.json'), 'utf8'));
    records.set(name, record); // Dados corrompidos impedem início; nunca sobrescrever silenciosamente.
  }
  // ponytail: fila única para a Central local; usar banco transacional em múltiplos processos.
  let pending = Promise.resolve();
  function write(action) { const result = pending.then(action); pending = result.catch(() => {}); return result; }
  async function body(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 64 * 1024 * 1024) throw Object.assign(new Error('O receptor local aceita até 64 MB por envio.'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (!/^((localhost|127\.0\.0\.1)(:\d+)?)$/.test(req.headers.host || '') || (origin && !allowedOrigins.includes(origin))) {
      json(res, 403, { error: 'Origem não autorizada nesta Central local.' }); return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/reports') {
        json(res, 200, { reports: [...records.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) }); return;
      }
      if (req.method === 'POST' && ['/reports', '/api/reports'].includes(url.pathname)) {
        const form = await new Request('http://localhost/reports', { method: 'POST', headers: req.headers, body: await body(req) }).formData();
        const report = JSON.parse(form.get('report'));
        const files = form.getAll('attachments');
        validate(report, files);
        const key = keyFor(report);
        const record = await write(async () => {
          if (records.has(key)) return records.get(key); // Retry após resposta perdida não duplica.
          const temporary = await fs.mkdtemp(path.join(dataDir, '.pending-'));
          try {
            const attachments = [];
            for (const [index, file] of files.entries()) {
              const bytes = Buffer.from(await file.arrayBuffer());
              if (!validImage(bytes, file.type)) throw Object.assign(new Error('O arquivo não corresponde ao formato de imagem informado.'), { status: 400 });
              await fs.writeFile(path.join(temporary, String(index)), bytes, { mode: 0o600 });
              attachments.push({ name: file.name, type: file.type, size: file.size, url: `/attachments/${key}/${index}` });
            }
            const saved = { key, report: { ...report, attachments: attachments.map(({ url, ...meta }) => meta) },
              attachments, status: 'novo', receivedAt: new Date().toISOString() };
            await fs.writeFile(path.join(temporary, 'report.json'), JSON.stringify(saved), { mode: 0o600 });
            await fs.rename(temporary, path.join(dataDir, key));
            records.set(key, saved); return saved;
          } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
        });
        json(res, 201, { id: record.report.id, key }); return;
      }
      const statusMatch = url.pathname.match(/^\/api\/reports\/([a-f0-9]{64})$/);
      if (req.method === 'PATCH' && statusMatch) {
        const input = JSON.parse((await body(req)).toString('utf8'));
        if (!states.includes(input.status)) { json(res, 400, { error: 'Status inválido.' }); return; }
        const saved = await write(async () => {
          const old = records.get(statusMatch[1]);
          if (!old) return null;
          const next = { ...old, status: input.status, updatedAt: new Date().toISOString() };
          const filename = path.join(dataDir, next.key, 'report.json');
          await fs.writeFile(`${filename}.tmp`, JSON.stringify(next), { mode: 0o600 });
          await fs.rename(`${filename}.tmp`, filename); records.set(next.key, next); return next;
        });
        json(res, saved ? 200 : 404, saved || { error: 'Ocorrência não encontrada.' }); return;
      }
      const attachmentMatch = url.pathname.match(/^\/attachments\/([a-f0-9]{64})\/(\d+)$/);
      if (req.method === 'GET' && attachmentMatch) {
        const file = records.get(attachmentMatch[1])?.attachments[Number(attachmentMatch[2])];
        if (!file || file.unavailable) { json(res, 404, { error: 'Imagem indisponível.' }); return; }
        const bytes = await fs.readFile(path.join(dataDir, attachmentMatch[1], attachmentMatch[2]));
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Security-Policy': "default-src 'none'; sandbox" }); res.end(bytes); return;
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/dashboard.js': ['dashboard.js', 'application/javascript'],
        '/dashboard.css': ['dashboard.css', 'text/css'], '/central-bugs.js': ['central-bugs.js', 'application/javascript'] };
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [filename, type] = staticFiles[url.pathname];
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        res.end(await fs.readFile(path.join(root, filename))); return;
      }
      json(res, 404, { error: 'Endereço não encontrado.' });
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError || error instanceof TypeError ? 400 : 500);
      if (status === 500) console.error('Falha ao armazenar ou ler ocorrência:', error.code || error.name);
      json(res, status, { error: status === 500 ? 'Não foi possível salvar. Seu relato pode ser reenviado.' : error.message });
    }
  });
}
module.exports = { createCentralServer, keyFor };
if (require.main === module) {
  createCentralServer().then(server => {
    server.listen(4173, '127.0.0.1', () => console.log('Central: http://localhost:4173 — dados em ./data'));
    const receiver = http.createServer(server.listeners('request')[0]);
    receiver.listen(4181, '127.0.0.1', () => console.log('Receptor do Radar: http://127.0.0.1:4181/reports'));
  }).catch(error => { console.error('Não foi possível iniciar a Central:', error.message); process.exitCode = 1; });
}
