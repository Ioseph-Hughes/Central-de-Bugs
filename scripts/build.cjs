// Publicar somente os arquivos da interface; o receptor em disco continua local.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function build(output = path.join(root, 'dist')) {
  await fs.rm(output, { recursive: true, force: true }); // Limpar somente a saída gerada, nunca a pasta data/.
  await fs.mkdir(output, { recursive: true });
  const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8'))
    .replace('<html lang="pt-BR">', '<html lang="pt-BR" data-central-mode="preview">');
  await fs.writeFile(path.join(output, 'index.html'), html);
  for (const filename of ['central-bugs.js', 'dashboard.js', 'dashboard.css']) {
    await fs.copyFile(path.join(root, filename), path.join(output, filename));
  }
}
module.exports = { build };
if (require.main === module) build().then(() => console.log('Prévia estática criada em dist/. O receptor online aguarda configuração.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
