// Chrome Android simulado: toque, DPR, rotação e ausência real de getDisplayMedia no contexto.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium, devices } = require('playwright');
const { createCentralServer } = require('../server.cjs');
const root = path.resolve(__dirname, '..');
const record = process.argv.includes('--record');
const listen = (server, port = 0) => new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => server.close(resolve));

(async () => {
  const dataDir = record ? path.join(root, 'data') : await fs.mkdtemp(path.join(os.tmpdir(), 'central-mobile-'));
  const artifacts = path.join(root, 'artifacts/mobile'); await fs.mkdir(artifacts, { recursive: true });
  const allowedOrigins = [];
  let server, saas, browser;
  try {
    server = await createCentralServer({ dataDir, allowedOrigins });
    const central = await listen(server, record ? 4173 : 0); allowedOrigins.push(central);
    saas = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teste mobile · captura de tela</title>
        <style>body{margin:0;font:16px system-ui;color:white}.intro{height:1100px;background:#122337}.screen{position:relative;min-height:1500px;background:#2f4b3a;padding:180px 24px 24px}h1{font-size:26px;margin:0 0 20px}.error-box{padding:18px;background:oklch(0.55 0.15 35);border-radius:12px}.fixed{position:fixed;top:0;left:0;width:30px;height:30px;background:#ba5039}.secret{position:absolute;top:70px;left:80px;width:80px;height:30px;margin:0;padding:0;border:0;background:magenta}.private{position:absolute;top:120px;left:80px;width:80px;height:30px;background:yellow}</style>
        <script defer src="${central}/central-bugs.js" data-project-id="central-demo" data-endpoint="${central}/reports"></script>
        </head><body><div class="intro">Conteúdo acima da área visível</div><main class="screen"><h1>Validação no Chrome mobile</h1><div class="error-box">Captura de tela e recorte por toque<br>Valor observado: R$ 1,23<br>Valor esperado: R$ 1.234,00</div><input type="password" class="secret" value="nao-capturar" aria-label="Senha de teste"><div class="private" data-central-bugs-private>Privado</div></main><div class="fixed"></div></body></html>`);
    });
    const source = await listen(saas, record ? 4180 : 0); allowedOrigins.push(source);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR' });
    context.setDefaultTimeout(15000);
    await context.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: undefined });
    });
    const mobile = await context.newPage();
    const errors = []; mobile.on('pageerror', error => errors.push(error.message));
    const captureRequests = []; mobile.on('request', request => { if (request.url().endsWith('/central-bugs-capture.js')) captureRequests.push(request.url()); });
    await mobile.goto(source); await mobile.evaluate(() => scrollTo(0, 1100));
    assert.equal(await mobile.evaluate(() => typeof navigator.mediaDevices.getDisplayMedia), 'undefined');
    assert.equal(await mobile.evaluate(() => navigator.maxTouchPoints > 0), true);
    assert.deepEqual(captureRequests, [], 'O renderizador só deve carregar ao solicitar uma captura.');
    const widget = mobile.locator('[data-central-bugs]');
    await widget.locator('.launch').tap(); await widget.getByRole('button', { name: 'Relatar um bug' }).tap();
    const title = '[Teste mobile] Captura no Chrome Android';
    const description = `Ambiente: Chromium com perfil Pixel 7, Android 14, toque, viewport 412 × 839 e DPR 2,625. Simulação de mobile; não é um aparelho físico.

Problema relatado: ao abrir o plugin no Chrome do celular e solicitar um print, a mensagem informava que o navegador não oferecia captura de tela, e nenhuma imagem era anexada.

Passos para reproduzir: 1. Abrir o sistema no Chrome Android. 2. Abrir Dar feedback e Relatar um bug. 3. Preencher título e descrição. 4. Solicitar captura da página ou Selecionar área. 5. Enviar o relato e abrir seus detalhes na Central.

Esperado: capturar a página visível, permitir recorte por toque e enviar a ocorrência com os PNGs.
Causa: getDisplayMedia indisponível no Chrome Android; o widget encerrava a captura sem alternativa.
Correção validada: renderização local da página visível quando a API nativa está ausente. O formulário, campos de senha e regiões marcadas como privadas ficam fora da imagem. Conteúdo fora da área visível não vira anexo.

Verificação: captura após rolagem, elemento fixo, CSS oklch, cancelamento de recorte mantendo rascunho, seleção por toque, rotação, envio HTTP multipart, gravação dos três PNGs e reabertura no painel mobile. Também foi verificada a recuperação após falha no carregamento do renderizador.

Limitação: a captura da página não inclui a barra do navegador nem outros aplicativos; conteúdo externo depende das permissões de origem.`;
    await widget.getByLabel('Título', { exact: true }).fill(title);
    await widget.getByLabel('O que aconteceu?', { exact: true }).fill(description);
    await widget.getByRole('button', { name: 'Capturar página' }).tap();
    await widget.locator('.attachment').waitFor();
    assert.deepEqual(captureRequests, [`${central}/central-bugs-capture.js`], 'Carregar junto ao script do plugin, mesmo instalado em outra origem.');

    async function pixels(index) {
      return widget.locator('.attachment img').nth(index).evaluate(async image => {
        await image.decode(); const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        return { width: canvas.width, height: canvas.height, fixed: pixel(5, 5), background: pixel(100, 80), password: pixel(200, 160), private: pixel(200, 260) };
      });
    }
    const portrait = await pixels(0);
    assert.equal(portrait.width, 824); assert.equal(portrait.height, 1678);
    const colorNear = (actual, expected, message) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 2), `${message}: ${actual}`);
    colorNear(portrait.fixed, [186, 80, 57, 255], 'Elemento fixo na posição correta');
    colorNear(portrait.background, [47, 75, 58, 255], 'Capturar a posição rolada da página');
    colorNear(portrait.password, [47, 75, 58, 255], 'Não desenhar o campo de senha');
    colorNear(portrait.private, [47, 75, 58, 255], 'Não desenhar regiões privadas');
    await mobile.screenshot({ path: path.join(artifacts, 'print-anexado.png') });
    await fs.writeFile(path.join(artifacts, 'captura-pagina.png'), Buffer.from(await widget.locator('.attachment img').first().evaluate(async image => [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())])));

    await widget.getByRole('button', { name: 'Selecionar área' }).tap();
    const crop = widget.locator('.crop-dialog'); await crop.waitFor();
    await crop.getByRole('button', { name: 'Cancelar', exact: true }).tap();
    await widget.getByText(/Recorte cancelado/).waitFor();
    assert.equal(await widget.getByLabel('Título', { exact: true }).inputValue(), title);
    assert.equal(await widget.locator('.attachment').count(), 1);
    await widget.getByRole('button', { name: 'Selecionar área' }).tap(); await crop.waitFor();
    const bounds = await crop.locator('canvas').boundingBox();
    assert.ok(bounds.height <= 839 * .48 + 1, 'A prévia do recorte deve caber na tela mobile.');
    const cdp = await context.newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width * .25, y: bounds.y + bounds.height * .25 }] });
    await mobile.waitForTimeout(80); // Dar ao gesto a duração de um arraste real.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width * .75, y: bounds.y + bounds.height * .75 }] });
    await mobile.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    await mobile.waitForTimeout(350); // Encerrar o gesto antes de iniciar outro toque.
    await mobile.screenshot({ path: path.join(artifacts, 'recorte-toque.png') });
    await crop.getByRole('button', { name: 'Anexar recorte' }).tap();
    await mobile.waitForFunction(() => document.querySelector('[data-central-bugs]').shadowRoot.querySelectorAll('.attachment').length === 2);
    const cropped = await pixels(1); assert.equal(cropped.width, 412); assert.equal(cropped.height, 839);
    assert.equal(captureRequests.length, 1, 'Reutilizar o renderizador.');
    await mobile.setViewportSize({ width: 839, height: 412 });
    await widget.getByRole('button', { name: 'Capturar página' }).tap();
    await widget.locator('.attachment').nth(2).waitFor();
    const landscape = await pixels(2); assert.equal(landscape.width, 1678); assert.equal(landscape.height, 824);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const received = mobile.waitForResponse(response => response.url() === `${central}/reports` && response.request().method() === 'POST');
    await widget.getByRole('button', { name: 'Enviar relato' }).tap();
    const response = await received; assert.equal(response.status(), 201);
    await widget.getByText(/Relato enviado/).waitFor();
    const saved = (await (await fetch(`${central}/api/reports`)).json()).reports.find(item => item.report.title === title && item.report.context.url === `${source}/`);
    assert.ok(saved); const { key } = saved;
    assert.equal(saved.report.title, title); assert.equal(saved.report.description, description);
    assert.equal(saved.report.type, 'bug'); assert.equal(saved.report.links.length, 0); assert.equal(saved.attachments.length, 3);
    for (const [index, file] of saved.attachments.entries()) {
      const bytes = Buffer.from(await (await fetch(central + file.url)).arrayBuffer());
      assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
      assert.equal(bytes.length, file.size);
      assert.ok(bytes.equals(await fs.readFile(path.join(dataDir, key, String(index)))));
    }
    assert.equal(await widget.locator('.attachment').count(), 0);
    await mobile.setViewportSize({ width: 412, height: 839 });
    const dashboard = await context.newPage(); dashboard.on('pageerror', error => errors.push(error.message));
    await dashboard.goto(central);
    await dashboard.locator('.occurrence').filter({ hasText: title }).first().tap();
    assert.equal(await dashboard.locator('.description').innerText(), description);
    await dashboard.locator('.gallery').scrollIntoViewIfNeeded();
    await dashboard.waitForFunction(() => [...document.querySelectorAll('.gallery img')].every(img => img.naturalWidth > 0));
    assert.equal(await dashboard.locator('.gallery img').count(), 3);
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dashboard.screenshot({ path: path.join(artifacts, 'ocorrencia-mobile.png') });
    await dashboard.reload(); await dashboard.locator('.occurrence').filter({ hasText: title }).first().waitFor();

    // Falha no arquivo complementar não perde o rascunho; a próxima tentativa recarrega.
    const retry = await context.newPage(); retry.on('pageerror', error => errors.push(error.message));
    let failLoad = true;
    await retry.route('**/central-bugs-capture.js', async route => {
      if (failLoad) { failLoad = false; await route.fulfill({ status: 503, body: '' }); } else await route.continue();
    });
    await retry.goto(source); const retryWidget = retry.locator('[data-central-bugs]');
    await retryWidget.locator('.launch').tap(); await retryWidget.getByRole('button', { name: 'Relatar um bug' }).tap();
    await retryWidget.getByLabel('Título', { exact: true }).fill('Rascunho mantido');
    await retryWidget.getByRole('button', { name: 'Capturar página' }).tap();
    await retryWidget.getByText(/Não foi possível capturar/).waitFor();
    assert.equal(await retryWidget.getByLabel('Título', { exact: true }).inputValue(), 'Rascunho mantido');
    assert.equal(await retryWidget.locator('fieldset').isDisabled(), false);
    await retryWidget.getByRole('button', { name: 'Capturar página' }).tap(); await retryWidget.locator('.attachment').waitFor();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'verificacao.json'), JSON.stringify({ simulation: devices['Pixel 7'], nativeCapture: false, key, persistedLocally: record, attachments: saved.attachments, checks: ['viewport rolado', 'elemento fixo', 'CSS oklch', 'exclusão de senha e região privada', 'cancelamento', 'recorte por toque', 'rotação', 'envio multipart', 'PNGs no disco', 'galeria no painel mobile', 'retry do renderizador'] }, null, 2));
    console.log(`OK: captura mobile sem getDisplayMedia, recorte por toque, rotação, envio de 3 PNGs, persistência, painel e retry.${record ? ` Ocorrência local: ${key}` : ''}`);
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      console.error(await page.locator('[data-central-bugs]').evaluate(host => ({ status: host.shadowRoot.querySelector('.status')?.textContent, attachments: host.shadowRoot.querySelectorAll('.attachment').length, crop: !!host.shadowRoot.querySelector('.crop-dialog') })));
      await page.screenshot({ path: path.join(artifacts, 'falha.png') });
    }
    throw error;
  } finally {
    await browser?.close(); if (saas) await close(saas); if (server) await close(server);
    if (!record) await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
