const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { createCentralServer } = require('../server.cjs');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => server.close(resolve));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'central-check-'));
  const allowedOrigins = [];
  let server, saas, browser;
  try {
    server = await createCentralServer({ dataDir, allowedOrigins });
    let central = await listen(server); allowedOrigins.push(central);
    saas = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="pt-BR"><head><title>Radar · integração</title>
        <script defer src="${central}/central-bugs.js" data-project-id="radar-contratual" data-endpoint="${central}/reports"></script>
        </head><body><h1>Radar de teste</h1></body></html>`);
    });
    const source = await listen(saas); allowedOrigins.push(source);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const dashboard = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
    const errors = []; dashboard.on('pageerror', e => errors.push(e.message));
    await dashboard.goto(central);
    await dashboard.getByText('Tudo começa com o primeiro relato.').waitFor();
    const radar = await browser.newPage(); await radar.goto(source);
    const widget = radar.locator('[data-central-bugs]');
    async function send(type, title, text) {
      await widget.locator('.launch').click();
      if (!await widget.locator('.choices').isVisible()) await widget.getByRole('button', { name: 'Alterar tipo de relato', exact: false }).click();
      await widget.locator(`[data-type="${type}"]`).click();
      await widget.getByLabel('Título', { exact: true }).fill(title);
      await widget.locator('textarea[name=description]').fill(text);
      await widget.locator('textarea[name=links]').fill('https://example.com/um\nhttps://example.com/dois');
      await widget.locator('input[type=file]').setInputFiles([
        { name: 'print.png', mimeType: 'image/png', buffer: png }, { name: 'outro.png', mimeType: 'image/png', buffer: png }
      ]);
      await widget.getByRole('button', { name: 'Enviar relato' }).click();
      await widget.locator('.status').filter({ hasText: 'Relato enviado' }).waitFor();
      await widget.getByRole('button', { name: 'Fechar', exact: true }).click();
    }
    const description = 'Texto completo\n' + 'Sem truncar os detalhes. '.repeat(1000) + '<script>window.injetado=true</script>';
    await send('bug', 'Falha ao salvar', description);
    await send('melhoria', 'Incluir busca por contrato', 'Sugestão de busca avançada.');
    // Outra origem enviando: os dois relatos aparecem automaticamente no painel já aberto.
    await dashboard.getByRole('button', { name: /Falha ao salvar/ }).waitFor({ timeout: 10000 });
    await dashboard.getByRole('button', { name: /Incluir busca por contrato/ }).waitFor({ timeout: 10000 });
    assert.equal(await dashboard.locator('.occurrence').count(), 2);
    await dashboard.getByRole('button', { name: /Radar Contratual/ }).click();
    assert.equal(await dashboard.locator('#total').textContent(), '2');
    await dashboard.getByRole('button', { name: /Falha ao salvar/ }).click();
    assert.equal(await dashboard.locator('.description').textContent(), description);
    assert.equal(await dashboard.evaluate(() => window.injetado), undefined);
    assert.equal(await dashboard.locator('.gallery img').count(), 2);
    await dashboard.locator('.gallery img').first().scrollIntoViewIfNeeded();
    await dashboard.waitForFunction(() => [...document.querySelectorAll('.gallery img')].every(img => img.complete && img.naturalWidth > 0), null, {timeout:10000});
    assert.equal(await dashboard.locator('.detail-links a').count(), 2);
    assert.equal(await dashboard.getByRole('link', { name: source + '/' }).getAttribute('href'), source + '/');
    await dashboard.getByLabel('Status da ocorrência').selectOption('em-correcao');
    await dashboard.getByText('Status salvo.', { exact: true }).waitFor();
    await dashboard.getByRole('button', { name: 'Fechar detalhes' }).click();
    await dashboard.getByRole('button', { name: 'Modo escuro', exact: false }).click();
    await dashboard.reload();
    await dashboard.locator('.occurrence').first().waitFor();
    assert.equal(await dashboard.locator('html').getAttribute('data-theme'), 'dark');
    await dashboard.locator('#type').selectOption('melhoria');
    assert.equal(await dashboard.locator('.occurrence').count(), 1);
    await dashboard.locator('#type').selectOption('');
    await dashboard.getByRole('button', { name: /Central · Testes/ }).click();
    assert.equal(await dashboard.locator('.occurrence').count(), 0);
    await dashboard.getByRole('button', { name: 'Testar o widget', exact: false }).click();
    const demo = dashboard.locator('[data-central-bugs]');
    await demo.locator('[data-type=ajuste]').click();
    await demo.getByLabel('Título', { exact: true }).fill('Ajustar espaçamento');
    await demo.locator('textarea[name=description]').fill('Relato de outro sistema.');
    await demo.getByRole('button', { name: 'Enviar relato' }).click();
    await demo.locator('.status').filter({ hasText: 'Relato salvo na Central' }).waitFor();
    await demo.getByRole('button', { name: 'Fechar', exact: true }).click();
    await dashboard.getByRole('button', { name: /Ajustar espaçamento/ }).waitFor({ timeout: 10000 });
    assert.equal(await dashboard.locator('.occurrence').count(), 1);
    await dashboard.getByRole('button', { name: /Todos os sistemas/ }).click();
    assert.equal(await dashboard.locator('.system-group').count(), 2);
    await dashboard.getByLabel('Buscar ocorrências').fill('busca avançada');
    assert.equal(await dashboard.locator('.occurrence').count(), 1);
    await dashboard.getByLabel('Buscar ocorrências').fill('');
    const received = (await (await fetch(`${central}/api/reports`)).json()).reports;
    assert.equal(received.length, 3);
    const saved = received.find(item => item.report.title === 'Falha ao salvar');
    const image = await fetch(central + saved.attachments[0].url);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    function form() { const body = new FormData(); body.append('report', JSON.stringify(saved.report)); for (const file of saved.attachments) body.append('attachments', new Blob([png], { type: file.type }), file.name); return body; }
    const retries = await Promise.all([fetch(`${central}/reports`, { method: 'POST', body: form() }), fetch(`${central}/reports`, { method: 'POST', body: form() })]);
    assert.ok(retries.every(response => response.status === 201));
    assert.equal((await (await fetch(`${central}/api/reports`)).json()).reports.length, 3);
    assert.equal((await fetch(`${central}/reports`, { method: 'POST', body: form(), headers: { Origin: 'https://www.radarcontratual.com' } })).status, 403);
    assert.equal((await fetch(`${central}/reports`, { method: 'POST', body: 'inválido' })).status, 400);
    const invalidImage = new FormData(); invalidImage.append('report', JSON.stringify({ ...saved.report, id: 'invalid-image', attachments: [{}] })); invalidImage.append('attachments', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
    assert.equal((await fetch(`${central}/reports`, { method: 'POST', body: invalidImage })).status, 400);
    assert.equal((await fetch(`${central}/api/reports/${saved.key}`, { method: 'PATCH', body: '{"status":"fake"}' })).status, 400);
    assert.equal((await fetch(`${central}/data`)).status, 404);
    // Reinício real: todos os relatos, imagens e status continuam disponíveis.
    await close(server); server = await createCentralServer({ dataDir, allowedOrigins });
    central = await listen(server); allowedOrigins.push(central);
    await dashboard.goto(central);
    await dashboard.locator('.occurrence').first().waitFor();
    assert.equal(await dashboard.locator('.occurrence').count(), 3);
    const afterRestart = (await (await fetch(`${central}/api/reports`)).json()).reports;
    assert.equal(afterRestart.find(item => item.key === saved.key).status, 'em-correcao');
    assert.deepEqual(Buffer.from(await (await fetch(central + saved.attachments[0].url)).arrayBuffer()), png);
    await dashboard.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dashboard.getByRole('button', { name: /Falha ao salvar/ }).click();
    const bounds = await dashboard.locator('#detail').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.deepEqual(errors, []);
    console.log('OK: dois envios do SaaS chegam ao painel, sistemas separados, detalhes completos, imagens binárias, busca, status, tema, celular, retry e persistência após reinício.');
  } finally { await browser?.close(); if (saas) await close(saas); if (server) await close(server); await fs.rm(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
