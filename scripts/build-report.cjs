// Biblioteca e fontes locais, carregadas apenas ao gerar o PDF de uma ocorrência.
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
async function buildReport(output) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'report-generator.js')],
    outfile: path.join(output || root, 'report-generator.bundle.js'),
    write: !!output, bundle: true, minify: true, format: 'iife', target: 'es2022', legalComments: 'inline'
  });
  return result.outputFiles?.[0].contents;
}
module.exports = { buildReport };
