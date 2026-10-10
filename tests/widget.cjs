// Verificação de integração: navegador real + servidor HTTP local, sem backend externo.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const directory = path.resolve(__dirname, '..');
  const requests = [];
  let rejectNext = false;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/reports') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      requests.push({ body: Buffer.concat(chunks).toString('utf8'), contentType: req.headers['content-type'] });
      res.writeHead(rejectNext ? 503 : 201); rejectNext = false; res.end(); return;
    }
    if (req.url === '/auto') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="pt-BR"><head><title>Instalação automática</title><script defer src="/central-bugs.js" data-project-id="auto-test" data-endpoint="/reports"></script></head><body><h1>Meu SaaS</h1></body></html>'); return;
    }
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teste isolado do widget</title><style>body{margin:0}.report p{white-space:pre-wrap;overflow-wrap:anywhere}.report img{width:50px}</style></head><body>
        <button id="open">Testar o widget</button><div id="reports"></div><script src="/central-bugs.js"></script><script>
        window.feedback = CentralBugs.init({projectId:'demo-saas', successMessage:'Relato recebido na demonstração!',
          onSubmit:async ({report,files}) => {
            const card=document.createElement('article');card.className='report';
            const p=document.createElement('p');p.textContent=report.description;card.append(p);
            for(const url of report.links){const a=document.createElement('a');a.href=url;a.textContent=url;card.append(a)}
            for(const file of files){const img=document.createElement('img');img.src=URL.createObjectURL(file);card.append(img)}
            document.querySelector('#reports').append(card);
          }});
        document.querySelector('#open').onclick=()=>feedback.open();
        </script></body></html>`); return;
    }
    const files = { '/central-bugs.js': 'central-bugs.js' };
    if (!files[req.url]) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(directory, files[req.url])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await fs.promises.mkdir(path.join(directory, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(directory, 'artifacts', 'demo.png'), fullPage: true });
    const widget = page.locator('[data-central-bugs]');
    await page.getByRole('button', { name: 'Testar o widget' }).click();
    await widget.getByRole('button', { name: 'Relatar um bug' }).click();
    await widget.getByLabel('Título', { exact: true }).fill('Botão de salvar não responde');
    const description = 'Primeira linha\n' + 'Texto longo de exemplo. '.repeat(1000) + '<script>window.injetado = true</script>';
    await widget.getByLabel('O que aconteceu?', { exact: true }).fill(description);
    await widget.getByLabel('Links', { exact: false }).fill('javascript:alert(1)');
    await widget.getByRole('button', { name: 'Enviar relato' }).click();
    await assertStatus(widget, 'Confira os links');
    assert.equal(await page.locator('.report').count(), 0);
    await widget.getByLabel('Links', { exact: false }).fill('https://example.com/primeiro\nhttps://example.com/segundo');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
    await widget.locator('input[type=file]').setInputFiles([
      { name: 'tela.png', mimeType: 'image/png', buffer: png },
      { name: 'outra-tela.png', mimeType: 'image/png', buffer: png }
    ]);
    assert.equal(await widget.locator('.attachment').count(), 2);
    await widget.getByRole('button', { name: 'Remover outra-tela.png' }).click();
    assert.equal(await widget.locator('.attachment').count(), 1);
    await widget.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Testar o widget' }).click();
    assert.equal(await widget.getByLabel('O que aconteceu?', { exact: true }).inputValue(), description);
    await widget.getByRole('button', { name: 'Enviar relato' }).click();
    await assertStatus(widget, 'recebido na demonstração');
    assert.equal(await page.locator('.report').count(), 1);
    assert.equal(await page.locator('.report p').textContent(), description);
    assert.equal(await page.evaluate(() => window.injetado), undefined);
    assert.equal(await page.locator('.report img').count(), 1);
    assert.equal(await page.locator('.report a').count(), 2);
    assert.equal(await widget.locator('.attachment').count(), 0);
    await widget.getByRole('button', { name: 'Fechar', exact: true }).click();

    // Recolher mantém somente a seta, com estado e posição persistidos.
    await page.getByRole('button', { name: 'Testar o widget' }).click();
    await widget.getByText('Posição e visibilidade do botão').click();
    await widget.getByLabel('Posição', { exact: true }).selectOption('top-left');
    await widget.getByRole('button', { name: 'Recolher na borda', exact: true }).click();
    assert.equal(await widget.getByRole('button', { name: 'Mostrar botão de feedback', exact: true }).isVisible(), true);
    assert.equal(await widget.locator('.launch').isVisible(), false);
    await page.reload();
    assert.equal(await widget.locator('.launcher.collapsed').isVisible(), true);
    assert.equal(await widget.locator('.launcher').getAttribute('data-edge'), 'left');
    assert.equal(await widget.locator('.restore').textContent(), '→');
    await widget.getByRole('button', { name: 'Mostrar botão de feedback', exact: true }).click();
    assert.equal(await widget.locator('.launch').isVisible(), true);
    assert.equal(await widget.locator('dialog').isVisible(), false);

    // Arrastar para o interior mantém expandido; atingir borda recolhe.
    async function dragTo(handle, x, y) {
      const rect = await handle.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
      await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
    }
    await dragTo(widget.locator('.launch'), 600, 500);
    assert.equal(await widget.locator('.launcher.collapsed').count(), 0);
    assert.equal(await widget.locator('dialog').isVisible(), false);
    await dragTo(widget.locator('.grip'), 1439, 800);
    assert.equal(await widget.locator('.launcher.collapsed').count(), 1);
    assert.equal(await widget.locator('.launcher').getAttribute('data-edge'), 'right');
    assert.ok((await widget.locator('.launcher').boundingBox()).x + (await widget.locator('.launcher').boundingBox()).width <= await page.evaluate(() => document.documentElement.clientWidth));
    await page.screenshot({ path: path.join(directory, 'artifacts', 'recolhido.png') });
    for (const [x, y, edge, arrow] of [[1, 400, 'left', '→'], [700, 1, 'top', '↓'], [800, 999, 'bottom', '↑'], [1439, 300, 'right', '←']]) {
      await dragTo(widget.locator('.restore'), x, y);
      assert.equal(await widget.locator('.launcher.collapsed').isVisible(), true);
      assert.equal(await widget.locator('.launcher').getAttribute('data-edge'), edge);
      assert.equal(await widget.locator('.restore').textContent(), arrow);
      assert.equal(await widget.locator('dialog').isVisible(), false);
    }
    // A posição lateral é preservada ao recarregar e redimensionar.
    const beforeReload = await widget.locator('.launcher').boundingBox();
    await page.reload();
    const afterReload = await widget.locator('.launcher').boundingBox();
    assert.ok(Math.abs(beforeReload.y - afterReload.y) < 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('[data-central-bugs]').shadowRoot.querySelector('.restore').getBoundingClientRect().right === 390);
    const arrowBounds = await widget.locator('.restore').boundingBox();
    assert.equal(arrowBounds.x + arrowBounds.width, 390);
    assert.ok(arrowBounds.y >= 0 && arrowBounds.y + arrowBounds.height <= 844);
    // Gesto de toque move a seta para outra borda sem abrir o widget.
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: arrowBounds.x + arrowBounds.width / 2, y: arrowBounds.y + arrowBounds.height / 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 1, y: 350 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    assert.equal(await widget.locator('.launcher').getAttribute('data-edge'), 'left');
    assert.equal(await widget.locator('.launcher.collapsed').isVisible(), true);
    assert.equal(await widget.locator('dialog').isVisible(), false);
    // Teclado expande sem abrir acidentalmente o formulário.
    await widget.locator('.restore').focus(); await page.keyboard.press('Enter');
    assert.equal(await widget.locator('.launch').isVisible(), true);
    assert.equal(await widget.locator('dialog').isVisible(), false);
    const expandedBounds = await widget.locator('.launcher').boundingBox();
    assert.equal(expandedBounds.x, 20);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Falha HTTP mantém anexos, conteúdo e ID; retry envia multipart de verdade.
    await page.evaluate(() => { feedback.destroy(); window.feedback = CentralBugs.init({ projectId: 'http-test', endpoint: '/reports' }); });
    await page.getByRole('button', { name: 'Testar o widget' }).click();
    await widget.getByRole('button', { name: 'Sugerir uma melhoria' }).click();
    await widget.getByLabel('Título', { exact: true }).fill('Exportar relatórios');
    await widget.locator('textarea[name=description]').fill('Adicionar exportação em CSV.');
    await widget.locator('input[type=file]').setInputFiles({ name: 'exemplo.png', mimeType: 'image/png', buffer: png });
    rejectNext = true;
    await widget.getByRole('button', { name: 'Enviar relato' }).click();
    await assertStatus(widget, 'foram preservados');
    assert.equal(await widget.getByLabel('Título', { exact: true }).inputValue(), 'Exportar relatórios');
    assert.equal(await widget.locator('.attachment').count(), 1);
    await widget.getByRole('button', { name: 'Enviar relato' }).click();
    await assertStatus(widget, 'Relato enviado');
    assert.equal(requests.length, 2);
    const extractReport = request => JSON.parse(request.body.match(/name="report"\r\n\r\n([^]*?)\r\n--/)[1]);
    const first = extractReport(requests[0]), second = extractReport(requests[1]);
    assert.equal(first.id, second.id);
    assert.equal(second.type, 'melhoria'); assert.equal(second.projectId, 'http-test');
    assert.equal(second.attachments.length, 1); assert.equal(second.context.url, `${origin}/`);
    assert.match(requests[1].contentType, /^multipart\/form-data; boundary=/);
    assert.match(requests[1].body, /name="attachments"; filename="exemplo.png"/);
    assert.equal(await widget.getByLabel('Título', { exact: true }).inputValue(), '');

    // Captura cancelada, captura de frame simulada e fim do compartilhamento.
    await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => { throw new DOMException('cancel', 'NotAllowedError'); } }));
    await widget.getByRole('button', { name: 'Tela inteira' }).click();
    await assertStatus(widget, 'Captura cancelada');
    assert.equal(await widget.locator('dialog').isVisible(), true);
    await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const paint = () => { ctx.fillStyle = '#2f4b3a'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#ba5039'; ctx.fillRect(160, 120, 320, 240); ctx.fillStyle = 'white'; ctx.font = '18px sans-serif'; ctx.fillText('Valor da variável: R$ 1.23', 180, 220); ctx.fillText('Esperado: R$ 1.234', 180, 250); }; paint();
      window.captureStream = canvas.captureStream(10);
      const timer = setInterval(paint, 50);
      const track = captureStream.getTracks()[0], originalStop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); originalStop(); };
      return captureStream;
    } }));
    await widget.getByRole('button', { name: 'Tela inteira' }).click();
    await widget.locator('.attachment').waitFor();
    assert.match(await widget.locator('.attachment span').textContent(), /^captura-\d+\.png$/);
    assert.equal(await page.evaluate(() => captureStream.getTracks()[0].readyState), 'ended');
    await widget.locator('dialog').waitFor({ state: 'visible' });
    async function attachmentPixels(index = 0) {
      return widget.locator('.attachment img').nth(index).evaluate(async img => {
        await img.decode(); const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        return { width: canvas.width, height: canvas.height, pixel: [...ctx.getImageData(0, 0, 1, 1).data] };
      });
    }
    assert.deepEqual(await attachmentPixels(), { width: 640, height: 480, pixel: [47, 75, 58, 255] });

    // Prévia reduzida: arraste invertido deve recortar os pixels da região original.
    await page.setViewportSize({ width: 1440, height: 800 });
    await widget.getByLabel('Título', { exact: true }).fill('Valor incompleto na variável');
    await widget.locator('textarea[name=description]').fill('O valor deveria conter todos os números.');
    await widget.getByRole('button', { name: 'Selecionar área' }).click();
    const crop = widget.locator('.crop-dialog');
    await crop.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => captureStream.getTracks()[0].readyState), 'ended');
    assert.equal(await crop.getByRole('button', { name: 'Anexar recorte' }).isDisabled(), true);
    const preview = await crop.locator('canvas').boundingBox();
    assert.ok(preview.width < 640, 'Prévia precisa exercitar conversão de escala.');
    await page.mouse.move(preview.x + preview.width * .75, preview.y + preview.height * .75);
    await page.mouse.down();
    await page.mouse.move(preview.x + preview.width * .25, preview.y + preview.height * .25, { steps: 8 });
    await page.mouse.up();
    await page.screenshot({ path: path.join(directory, 'artifacts', 'selecao-area.png'), fullPage: true });
    assert.match(await crop.locator('.crop-info').textContent(), /320 × 240 px/);
    await crop.getByRole('button', { name: 'Anexar recorte' }).click();
    await widget.locator('.attachment').nth(1).waitFor();
    assert.deepEqual(await attachmentPixels(1), { width: 320, height: 240, pixel: [186, 80, 57, 255] });
    assert.match(await widget.locator('.attachment span').nth(1).textContent(), /^recorte-\d+\.png$/);
    assert.equal(await widget.locator('.capture-area').evaluate(node => node.getRootNode().activeElement === node), true);

    // Cancelamento por botão e Escape preserva rascunho e os dois anexos.
    for (const cancelWith of ['button', 'escape']) {
      await widget.getByRole('button', { name: 'Selecionar área' }).click(); await crop.waitFor();
      if (cancelWith === 'button') await crop.getByRole('button', { name: 'Cancelar', exact: true }).click();
      else await page.keyboard.press('Escape');
      await assertStatus(widget, 'Recorte cancelado');
      assert.equal(await widget.locator('.attachment').count(), 2);
      assert.equal(await widget.getByLabel('Título', { exact: true }).inputValue(), 'Valor incompleto na variável');
      assert.equal(await widget.locator('fieldset').isDisabled(), false);
      assert.equal(await crop.count(), 0);
    }

    // Medidas por teclado, limite da imagem e layout móvel.
    await page.setViewportSize({ width: 390, height: 844 });
    await widget.getByRole('button', { name: 'Selecionar área' }).click(); await crop.waitFor();
    const cropBounds = await crop.boundingBox();
    assert.ok(cropBounds.x >= 0 && cropBounds.x + cropBounds.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mobilePreview = await crop.locator('canvas').boundingBox();
    await crop.locator('canvas').click();
    assert.equal(await crop.getByRole('button', { name: 'Anexar recorte' }).isDisabled(), true);
    const cropTouch = await page.context().newCDPSession(page);
    await cropTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mobilePreview.x + mobilePreview.width * .1, y: mobilePreview.y + mobilePreview.height * .1 }] });
    await cropTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mobilePreview.x + mobilePreview.width * .5, y: mobilePreview.y + mobilePreview.height * .5 }] });
    await cropTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cropTouch.detach();
    assert.match(await crop.locator('.crop-info').textContent(), /256 × 192 px/);
    await crop.getByText('Ajustar recorte por medidas').click();
    await crop.getByLabel('Esquerda (px)').fill('630'); await page.keyboard.press('Tab');
    await crop.getByLabel('Topo (px)').fill('470'); await page.keyboard.press('Tab');
    await crop.getByLabel('Largura (px)').fill('5000'); await page.keyboard.press('Tab');
    await crop.getByLabel('Altura (px)').fill('5000'); await page.keyboard.press('Tab');
    assert.match(await crop.locator('.crop-info').textContent(), /10 × 10 px/);
    await page.screenshot({ path: path.join(directory, 'artifacts', 'selecao-area-mobile.png'), fullPage: true });
    await crop.getByRole('button', { name: 'Anexar recorte' }).focus(); await page.keyboard.press('Enter');
    await widget.locator('.attachment').nth(2).waitFor();
    assert.deepEqual(await attachmentPixels(2), { width: 10, height: 10, pixel: [47, 75, 58, 255] });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(directory, 'artifacts', 'capturas-anexadas.png'), fullPage: true });

    // A mesma pipeline envia o PNG recortado, sem anexar outra imagem completa.
    await widget.getByRole('button', { name: 'Enviar relato' }).click(); await assertStatus(widget, 'Relato enviado');
    const captured = extractReport(requests[2]);
    assert.equal(captured.attachments.length, 3);
    assert.match(captured.attachments[1].name, /^recorte-/);
    assert.ok(captured.attachments[1].size < captured.attachments[0].size);
    await widget.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Testar o widget' }).focus();
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#open').evaluate(node => node === document.activeElement), true);

    // Celular: formulário visível, sem transbordamento lateral.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Testar o widget' }).click();
    const bounds = await widget.locator('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(directory, 'artifacts', 'mobile.png'), fullPage: true });
    await page.evaluate(() => feedback.destroy());
    assert.equal(await page.locator('[data-central-bugs]').count(), 0);

    // Um único script com atributos inicializa e envia ao endpoint configurado.
    await page.goto(`${origin}/auto`);
    const autoWidget = page.locator('[data-central-bugs="auto-test"]');
    await autoWidget.locator('.launch').click();
    await autoWidget.getByRole('button', { name: 'Pedir um ajuste' }).click();
    await autoWidget.getByLabel('Título', { exact: true }).fill('Ajustar o espaçamento');
    await autoWidget.locator('textarea[name=description]').fill('Mais espaço entre os campos.');
    await autoWidget.getByRole('button', { name: 'Enviar relato' }).click();
    await assertStatus(autoWidget, 'Relato enviado');
    assert.equal(extractReport(requests[3]).projectId, 'auto-test');
    await page.evaluate(() => CentralBugs.instance.hide());
    assert.equal(await autoWidget.locator('.restore').isVisible(), true);
    await autoWidget.locator('.restore').click();
    assert.equal(await autoWidget.locator('.launch').isVisible(), true);
    await page.evaluate(() => CentralBugs.instance.destroy());
    assert.equal(await page.locator('[data-central-bugs]').count(), 0);
    // Desmontar durante a seleção encerra a promessa e remove a prévia.
    await page.goto(origin);
    await page.getByRole('button', { name: 'Testar o widget' }).click();
    await widget.getByRole('button', { name: 'Relatar um bug' }).click();
    await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d'); window.captureStream = canvas.captureStream(10);
      const timer = setInterval(() => ctx.fillRect(0, 0, 32, 32), 50);
      const track = captureStream.getTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); }; return captureStream;
    } }));
    await widget.getByRole('button', { name: 'Selecionar área' }).click();
    await widget.locator('.crop-dialog').waitFor();
    await page.evaluate(() => feedback.destroy());
    assert.equal(await widget.count(), 0);
    assert.equal(await page.evaluate(() => captureStream.getTracks()[0].readyState), 'ended');
    assert.deepEqual(errors, []);
    console.log('OK: instalação por tag, recolhimento/arraste nas 4 bordas, persistência, envio, erro/retry, anexos, captura, teclado e celular.');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function assertStatus(widget, text) {
  await widget.locator('.status').filter({ hasText: text }).waitFor({ state: 'visible' });
}
