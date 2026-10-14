const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createCentralServer } = require('../server.cjs');
const pdf = require('./pdf-fixture.cjs');

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'central-export-'));
  const artifacts = path.join(__dirname, '../artifacts/export'); await fs.mkdir(artifacts, { recursive: true });
  const allowedOrigins = [], server = await createCentralServer({ dataDir, allowedOrigins });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    allowedOrigins.push(base);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await page.addInitScript(() => {
      window.exportObjectURLs = new Set();
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.exportObjectURLs.add(url); return url; };
      URL.revokeObjectURL = url => { window.exportObjectURLs.delete(url); revoke(url); };
    });
    await page.goto(base);
    const images = await page.evaluate(() => {
      return [{ width: 1600, height: 900 }, { width: 800, height: 3200 }].map(({ width, height }) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = '#edf5ef'; drawing.fillRect(0, 0, width, height);
        drawing.fillStyle = '#27634f'; drawing.font = 'bold 34px sans-serif';
        for (let y = 60; y < height; y += 240) { drawing.fillText(`Captura de teste - linha ${y}`, 25, y); drawing.fillRect(25, y + 25, width - 50, 3); }
        return canvas.toDataURL('image/png').split(',')[1];
      });
    });
    async function submit(id, attachments, description = 'Descrição com acentuação: ação, ocorrência e resolução.') {
      const report = {
        schemaVersion: 1, id, projectId: 'central-demo', type: 'bug', title: `Ocorrência ${id}`, description,
        createdAt: new Date().toISOString(), links: ['https://example.com/evidencia'],
        context: { url: 'https://example.com/pagina', pageTitle: 'Página de origem', language: 'pt-BR', viewport: { width: 1600, height: 900 }, extra: 'Contexto adicional' },
        user: { email: 'usuario@example.com', name: 'João' }, custom: 'Campo da integração',
        attachments: attachments.map(file => ({ name: file.name, type: file.type, size: file.buffer.length }))
      };
      const form = new FormData(); form.append('report', JSON.stringify(report));
      for (const file of attachments) form.append('attachments', new Blob([file.buffer], { type: file.type }), file.name);
      const response = await fetch(base + '/reports', { method: 'POST', body: form }); assert.equal(response.status, 201);
      return (await response.json()).key;
    }
    const description = 'Começo da descrição\n' + 'Texto completo com acentuação. '.repeat(500) + '\nFIM SEM TRUNCAMENTO\n<script>window.injetado=true</script>';
    const key = await submit('com-anexos', [
      { name: 'print-amplo.png', type: 'image/png', buffer: Buffer.from(images[0], 'base64') },
      { name: 'print-comprido.png', type: 'image/png', buffer: Buffer.from(images[1], 'base64') },
      { name: 'relatório.pdf', type: 'application/pdf', buffer: pdf },
      { name: 'outro.pdf', type: 'application/pdf', buffer: Buffer.concat([pdf, Buffer.from('\n% segundo arquivo')]) }
    ], description);
    await submit('sem-anexos', []);
    await submit('so-pdf', [{ name: 'original.pdf', type: 'application/pdf', buffer: pdf }]);
    await page.getByRole('button', { name: 'Atualizar', exact: false }).click();
    await page.getByRole('button', { name: 'Abrir ocorrência: Ocorrência com-anexos', exact: true }).click();
    assert.equal(requests.some(url => url.endsWith('/report-generator.bundle.js')), false);
    await page.getByLabel('Status da ocorrência', { exact: true }).selectOption('em-correcao');
    await page.getByText('Status salvo.', { exact: true }).waitFor();
    const exportDialog = page.locator('#export-dialog');
    // Falha na biblioteca permite tentar novamente, mantendo os anexos originais disponíveis.
    await page.route('**/report-generator.bundle.js', route => route.fulfill({ status: 503, body: '' }));
    await page.getByRole('button', { name: 'Gerar arquivo', exact: true }).click();
    await page.getByRole('button', { name: 'Tentar gerar novamente' }).waitFor();
    assert.equal(await page.locator('#export-result').isVisible(), false);
    assert.equal(await exportDialog.getByRole('button', { name: /^Baixar arquivo:/ }).count(), 2);
    await page.unroute('**/report-generator.bundle.js');
    // Uma imagem que falha nunca resulta em um PDF silenciosamente incompleto.
    await page.route(`**/attachments/${key}/0`, route => route.fulfill({ status: 503, body: '' }));
    await page.getByRole('button', { name: 'Tentar gerar novamente' }).click();
    await exportDialog.getByText(/Não foi possível carregar a imagem/).waitFor();
    assert.equal(await page.locator('#export-result').isVisible(), false);
    await page.unroute(`**/attachments/${key}/0`);
    await page.getByRole('button', { name: 'Tentar gerar novamente' }).click();
    await page.getByRole('link', { name: 'Baixar PDF', exact: true }).waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Baixar PDF', exact: true }).click()]);
    assert.match(download.suggestedFilename(), /^Ocorrencia-com-anexos-[a-f0-9]{8}\.pdf$/);
    await download.saveAs(path.join(artifacts, 'ocorrencia.pdf'));
    assert.equal((await fs.readFile(path.join(artifacts, 'ocorrencia.pdf'))).subarray(0, 5).toString(), '%PDF-');
    assert.equal(await page.evaluate(() => window.injetado), undefined);
    await exportDialog.screenshot({ path: path.join(artifacts, 'janela-desktop.png') });
    for (const [name, bytes] of [['relatório.pdf', pdf], ['outro.pdf', Buffer.concat([pdf, Buffer.from('\n% segundo arquivo')])]]) {
      const [original] = await Promise.all([page.waitForEvent('download'), exportDialog.getByRole('button', { name: `Baixar arquivo: ${name}`, exact: true }).click()]);
      assert.equal(original.suggestedFilename(), name); assert.deepEqual(await fs.readFile(await original.path()), bytes);
    }
    await page.getByRole('button', { name: 'Fechar geração de arquivo' }).click();
    await page.waitForFunction(() => window.exportObjectURLs.size === 0);
    assert.equal(await page.locator('#export-download').getAttribute('href'), null);
    // Cancelar no meio da geração não publica resultado depois que a janela fecha.
    let release; const pending = new Promise(resolve => { release = resolve; });
    await page.route(`**/attachments/${key}/0`, async route => { await pending; await route.fulfill({ status: 503, body: '' }).catch(() => {}); });
    await page.getByRole('button', { name: 'Gerar arquivo', exact: true }).click();
    await exportDialog.getByText('Incluindo imagem: print-amplo.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fechar geração de arquivo' }).click(); release();
    await page.unroute(`**/attachments/${key}/0`);
    await page.getByRole('button', { name: 'Fechar detalhes' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of ['sem-anexos', 'so-pdf']) {
      await page.getByRole('button', { name: `Abrir ocorrência: Ocorrência ${id}`, exact: true }).click();
      await page.getByRole('button', { name: 'Gerar arquivo', exact: true }).click();
      await page.getByRole('link', { name: 'Baixar PDF', exact: true }).waitFor();
      assert.equal(await exportDialog.getByRole('button', { name: /^Baixar arquivo:/ }).count(), id === 'so-pdf' ? 1 : 0);
      const bounds = await exportDialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await exportDialog.screenshot({ path: path.join(artifacts, `janela-mobile-${id}.png`) });
      await page.getByRole('button', { name: 'Fechar geração de arquivo' }).click();
      await page.getByRole('button', { name: 'Fechar detalhes' }).click();
    }
    await page.waitForFunction(() => window.exportObjectURLs.size === 0);
    assert.deepEqual(errors, []);
    console.log('OK: PDF real com texto longo e prints amplo/comprido, download binário de vários originais, falhas/retentativa, cancelamento, limpeza, sem anexos, somente PDF, celular e carregamento sob demanda.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
