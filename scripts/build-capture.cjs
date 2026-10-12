// Gerar o arquivo complementar; ele só é carregado ao capturar sem getDisplayMedia.
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
async function buildCapture(output = root) {
  const license = await fs.readFile(path.join(path.dirname(require.resolve('html2canvas-pro')), '../LICENSE'), 'utf8');
  await esbuild.build({
    stdin: { contents: "import capture from 'html2canvas-pro'; window.CentralBugsPageCapture = capture;", resolveDir: root },
    outfile: path.join(output, 'central-bugs-capture.js'), bundle: true, minify: true, format: 'iife', target: 'es2022',
    banner: { js: `/*! html2canvas-pro 2.0.0 — https://github.com/yorickshan/html2canvas-pro\n${license}\n*/` }
  });
}
module.exports = { buildCapture };
if (require.main === module) buildCapture().catch(error => { console.error(error); process.exitCode = 1; });
