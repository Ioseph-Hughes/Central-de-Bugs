// Compatibilidade com o comando antigo: agora usa a Central persistente.
if (process.argv.includes('--check')) require('./central.cjs');
else {
  console.log('Use npm start: o painel em 4173 e o receptor em 4181 compartilham os relatos em disco.');
  process.exitCode = 1;
}
