// Publicar somente os arquivos da interface; o receptor em disco continua local.
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const { buildCapture } = require('./build-capture.cjs');
const { buildReport } = require('./build-report.cjs');
const { widgetRelease } = require('./widget-release.cjs');
const root = path.resolve(__dirname, '..');
async function build(output = path.join(root, 'dist')) {
  await fs.rm(output, { recursive: true, force: true }); // Limpar somente a saída gerada, nunca a pasta data/.
  await fs.mkdir(output, { recursive: true });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!!url !== !!key) throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY juntas.');
  const cloud = !!url;
  if (cloud && (new URL(url).protocol !== 'https:' || !key.startsWith('sb_publishable_'))) throw new Error('Use URL HTTPS e chave publicável do Supabase; nunca uma chave secreta no build.');
  const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8'))
    .replace('<html lang="pt-BR">', `<html lang="pt-BR" data-central-mode="${cloud ? 'cloud' : 'preview'}">`)
    .replace('<script defer src="/dashboard.js"></script>', `${cloud ? '<script defer src="/cloud.js"></script>' : ''}<script defer src="/dashboard.js"></script>`)
    .replace('<div id="workspace">', `<div id="workspace"${cloud ? ' hidden' : ''}>`)
    .replace('class="login-screen" hidden', `class="login-screen"${cloud ? '' : ' hidden'}`);
  await fs.writeFile(path.join(output, 'index.html'), html);
  for (const filename of ['central-bugs.js', 'dashboard.js', 'dashboard.css','notifications.js','service-worker.js','manifest.webmanifest']) {
    await fs.copyFile(path.join(root, filename), path.join(output, filename));
  }
  await fs.cp(path.join(root,'icons'),path.join(output,'icons'),{recursive:true});
  await buildCapture(output);
  await buildReport(output);
  const widget=await widgetRelease(path.join(output,'central-bugs-capture.js'));
  await fs.writeFile(path.join(output,'central-bugs.js'),widget.code);
  await fs.writeFile(path.join(output,'central-bugs-version.json'),JSON.stringify(widget.manifest));
  if (cloud) await esbuild.build({entryPoints:[path.join(root,'cloud.js')],outfile:path.join(output,'cloud.js'),bundle:true,minify:true,platform:'browser',target:'es2022',define:{CENTRAL_CONFIG:JSON.stringify({url,key})}});
}
module.exports = { build };
if (require.main === module) build().then(() => console.log('Build criado em dist/. Modo online habilitado quando as duas variáveis públicas estão configuradas.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
