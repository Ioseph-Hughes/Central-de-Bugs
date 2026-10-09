// Receptor apenas para teste local da integração. Não persiste nem envia dados externos.
const http = require('node:http');
let latestReport;
const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !['http://localhost:4180', 'http://127.0.0.1:4180'].includes(origin)) {
    response.writeHead(403); response.end(); return;
  }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method === 'GET' && request.url === '/latest') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(latestReport || null)); return;
  }
  if (request.method !== 'POST' || request.url !== '/reports') { response.writeHead(404); response.end(); return; }
  try {
    const form = await new Request('http://127.0.0.1:4181/reports', { method: 'POST', headers: request.headers, body: request, duplex: 'half' }).formData();
    const report = JSON.parse(form.get('report'));
    const files = form.getAll('attachments');
    latestReport = { report, receivedFiles: files.map(file => ({ name: file.name, type: file.type, size: file.size })) };
    console.log(`Recebido em teste: ${report.projectId} · ${report.type} · ${files.length} imagem(ns).`);
    response.writeHead(201, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ id: report.id }));
  } catch {
    response.writeHead(400); response.end('Relato inválido.');
  }
});
const check = process.argv.includes('--check');
server.listen(check ? 0 : 4181, '127.0.0.1', async () => {
  if (!check) { console.log('Receptor de teste em http://127.0.0.1:4181 — relatos somente em memória.'); return; }
  const assert = require('node:assert/strict');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const form = new FormData();
    form.append('report', JSON.stringify({ id: 'receiver-check', projectId: 'radar-contratual', type: 'bug' }));
    form.append('attachments', new Blob(['imagem de teste'], { type: 'image/png' }), 'teste.png');
    const response = await fetch(`${url}/reports`, { method: 'POST', body: form, headers: { Origin: 'http://localhost:4180' } });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:4180');
    const received = await (await fetch(`${url}/latest`)).json();
    assert.equal(received.report.id, 'receiver-check');
    assert.equal(received.receivedFiles[0].name, 'teste.png');
    assert.equal(received.receivedFiles[0].size, Buffer.byteLength('imagem de teste'));
    assert.equal((await fetch(`${url}/reports`, { method: 'POST', headers: { Origin: 'https://www.radarcontratual.com' } })).status, 403);
    assert.equal((await fetch(`${url}/reports`, { method: 'POST', body: 'inválido' })).status, 400);
    console.log('OK: receptor multipart, arquivos completos, CORS local e rejeição de payload inválido.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { server.close(); }
});
