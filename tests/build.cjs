const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
const { build } = require('../scripts/build.cjs');
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'central-static-'));
  const config = require('../vercel.json');
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  await fs.writeFile(path.join(output, 'server.cjs'), 'arquivo de um build anterior');
  await build(output);
  const filenames = ['index.html', 'central-bugs.js', 'dashboard.js', 'dashboard.css'];
  assert.deepEqual((await fs.readdir(output)).sort(), filenames.toSorted());
  assert.doesNotMatch(await fs.readFile(path.join(__dirname, '..', 'index.html'), 'utf8'), /data-central-mode="preview"/);
  const server = http.createServer(async (req, res) => {
    const filename = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (req.method !== 'GET' || !filenames.includes(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await fs.readFile(path.join(output, filename)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ colorScheme: 'light' });
    const errors = [], apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) apiRequests.push(req.url()); });
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await page.goto(base)).status(), 200);
    await page.getByText('Conecte o armazenamento da Central.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Envio ainda não configurado', exact: true }).isEnabled(), false);
    assert.equal(await page.locator('[data-central-bugs]').count(), 0);
    await page.getByRole('button', { name: 'Modo escuro', exact: false }).click();
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').getAttribute('data-central-mode'), 'preview');
    assert.equal((await fetch(`${base}/central-bugs.js`)).status, 200);
    for (const url of ['/server.cjs', '/data', '/.env', '/api/reports']) assert.equal((await fetch(base + url)).status, 404);
    await page.waitForTimeout(3100); // A prévia não inicia o polling de três segundos.
    assert.deepEqual(apiRequests, []); assert.deepEqual(errors, []);
    console.log('OK: saída estática isolada, painel 200 sem função local, aviso de configuração, envio indisponível, tema e ausência de dados/servidor/API no pacote.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(output, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
