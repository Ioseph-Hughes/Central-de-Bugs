# Central de Bugs · v0.9

**Para integrar um sistema novo com ID e contas autorizadas, siga [INTEGRACAO-PARA-IA.md](INTEGRACAO-PARA-IA.md).** Os exemplos de `init` e instalação por tag abaixo são do modo local/legado e não substituem a autenticação exigida pelos novos cadastros.

Widget de feedback reutilizável, sem instalação de pacotes ou etapa de build no SaaS. A interface fica em um Shadow DOM para isolar seus estilos. A captura mobile usa um renderizador local carregado somente quando solicitado.

Para entender o propósito, o fluxo de uso e como compartilhar a integração, leia [GUIA-DO-PLUGIN.md](GUIA-DO-PLUGIN.md).

## Testar agora

Na pasta do projeto:

```sh
npm start
```

Com Node.js 22, abra http://localhost:4173. O painel e o receptor local agora compartilham uma caixa de entrada persistente. O Radar de teste em `localhost:4180` continua enviando para `http://127.0.0.1:4181/reports`.

O comando inicia as portas 4173 (painel/API) e 4181 (receptor compatível com o Radar). Não use o servidor Python antigo em paralelo. As duas portas atendem à mesma Central.

- Sistemas separados na navegação e nas listas; novos sistemas são cadastrados na Central de Sistemas antes do primeiro relato.
- Ocorrências de bug/erro, melhoria ou ajuste, com busca e filtros de tipo/status.
- Detalhes com texto completo, imagens, links, página de origem, horário e contexto.
- Blocos por empresa: Bugs novos, Em análise, Em processamento e Terminados. Os valores internos permanecem `novo`, `em-analise`, `em-correcao` e `resolvido`. O botão **Resolver** em cada ocorrência marca como resolvida diretamente na lista; a alteração fica salva e pode ser revista nos detalhes.
- Atualização automática a cada três segundos com a aba visível e atualização manual.
- Modo claro/escuro com preferência persistida no navegador; inicialmente segue o sistema.

Os relatos e arquivos são salvos em `data/`, que está excluída do Git. Recarga e reinício do servidor mantêm relatos, imagens e status. Cada envio é confirmado somente depois de gravar o registro e seus arquivos; novas tentativas com o mesmo par `projectId` + `id` não duplicam ocorrências. Faça backup dessa pasta para preservar os dados ao mover a Central.

Este receptor é para testes locais: escuta apenas em loopback e aceita as origens `localhost`/`127.0.0.1` das portas 4173 e 4180. A publicação online usa uma API separada, com Supabase e autenticação; veja o guia abaixo. O limite do receptor local é 64 MB por requisição; o widget continua sem limite de texto ou quantidade de imagens imposto pela interface.

O receptor antigo armazenava somente o último relato em memória, sem guardar os arquivos. Esses envios não constituem um histórico recuperável. Uma ocorrência importada desse receptor deve indicar explicitamente as imagens indisponíveis.

## Publicar com Supabase e Vercel

Siga [DEPLOY.md](DEPLOY.md) para instalar o SQL, criar o administrador, configurar as quatro variáveis e instalar o plugin no Radar. [`.env.example`](.env.example) contém os nomes e as duas configurações públicas do projeto informado. Nunca adicione uma chave secreta ao Git.

A versão online usa login por e-mail/senha, leitura, cadastro de sistemas, alteração de status e exclusão restritos aos administradores, tabelas com RLS e bucket privado. O widget envia arquivos diretamente por URLs assinadas do Supabase e confirma a ocorrência somente após verificar todos os anexos. Domínios permitidos e sistemas ficam em `central_projects`. O dashboard busca detalhes completos sob demanda; as imagens recebem links temporários e a lista atualiza a cada 15 segundos. A API inclui quotas persistentes de envio.

`npm run build` cria `dist/` com uma lista explícita de arquivos públicos. Se `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` estiverem configuradas, inclui o login empacotado em `cloud.js`. O build não publica chaves secretas, `.env`, o receptor local ou `data/`. A Vercel executa `api/reports.js`, sem usar disco local para ocorrências. O SDK oficial do Supabase gerencia as sessões; o plugin distribuído continua sem dependências.

Sem as duas variáveis públicas, o build mantém uma **prévia**, com aviso de armazenamento pendente e envio desativado. Com elas, o login é exibido; ainda é necessário executar o SQL, cadastrar o administrador e configurar `SUPABASE_SECRET_KEY` e `CENTRAL_ORIGIN` para usar a API. A Central local de `npm start` continua independente, com os dados em disco; não há migração automática.

Use **Framework: Other**, **Build: npm run build**, **Output: dist**, raiz do repositório e Node.js 22. Publique `main` novamente após configurar as variáveis. Os limites de texto, tamanho de imagem, quotas e histórico da versão online estão documentados no guia.

Se aparecer **500 FUNCTION_INVOCATION_FAILED**, abra os logs da função no deployment atual. Esse código sozinho não identifica a causa.

## Instalar em um SaaS

Copie `central-bugs.js` e `central-bugs-capture.js` para a mesma pasta pública do seu frontend e adicione uma única tag HTML. O segundo arquivo contém html2canvas-pro (MIT), já empacotado, e só é carregado em navegadores sem captura nativa. Quando o script vem da Central, o arquivo complementar é buscado na própria Central. O botão aparece automaticamente:

```html
<script defer
  src="/central-bugs.js"
  data-project-id="portal-cliente"
  data-endpoint="https://sua-central.com/api/reports"
  data-transport="signed-upload"
></script>
```

Cadastre o identificador e os domínios no Supabase antes de usar o SaaS online. Omita `data-transport` para um receptor multipart, incluindo a Central local. Opcionalmente, `data-position="top-left"` define o canto inicial. A instância automática fica disponível em `CentralBugs.instance`.

Para fornecer dados de usuário ou usar um callback, carregue o script sem `data-project-id` e inicialize manualmente depois do carregamento do DOM:

```html
<script src="/central-bugs.js"></script>
<script>
  const feedback = CentralBugs.init({
    projectId: 'portal-cliente',
    endpoint: 'https://sua-central.com/api/reports',
    transport: 'signed-upload',
    position: 'bottom-right',
    // Opcional: fornecido pelo próprio SaaS.
    user: { id: 'usuario-123', name: 'Maria' }
  });
</script>
```

Em React/Vue/etc., carregue o script uma vez, inicialize depois de montar e chame `feedback.destroy()` ao desmontar. Se o endpoint ainda não existir, use `onSubmit` para conectar ao serviço que o SaaS já utiliza:

```js
const feedback = CentralBugs.init({
  projectId: 'portal-cliente',
  onSubmit: async ({ report, files }) => {
    // Retorne uma Promise que resolva somente após o recebimento.
    // Lance um erro se houver falha: o widget preservará o rascunho.
    await meuServico.enviarRelato(report, files);
  }
});
```

`onSubmit` tem prioridade sobre `endpoint`. Sem nenhuma dessas opções o widget informa que o envio não está configurado e mantém o relato.

## Recursos desta versão

- Bug, melhoria ou ajuste; título, texto livre e múltiplos links HTTP/HTTPS.
- Múltiplas imagens PNG, JPEG, WebP, GIF e AVIF, com prévia e remoção.
- Upload, colagem de prints e duas opções lado a lado: **Selecionar área** ou **Tela inteira**. A seleção abre uma prévia para arrastar o recorte ou ajustar suas medidas por teclado; somente o PNG recortado é anexado. Cancelar mantém o rascunho. O compartilhamento termina antes da edição.
- No Chrome Android e em outros navegadores sem `getDisplayMedia`, **Capturar página** gera uma imagem da parte visível do SaaS, incluindo a posição de rolagem. **Selecionar área** permite recortá-la por toque. O widget, campos de senha e elementos com `data-central-bugs-private` ficam fora dessa imagem. O PNG é revisado e enviado pelo mesmo fluxo dos outros anexos.
- Arraste o botão pela alça ou pelo próprio texto. Solte junto a uma borda (até 32 px) para recolher; solte no interior para mantê-lo expandido.
- Recolhido, mostra somente uma seta apontando para dentro da tela. Clique para expandir ou arraste a seta até outra posição/borda, inclusive nos cantos. Também há um botão de recolher e escolha de cantos pelo menu, acessíveis por teclado.
- Posição proporcional à janela, borda e estado recolhido persistem no navegador por projeto e se ajustam a mudanças de resolução. Texto e anexos ficam somente na memória, preservados ao fechar o formulário ou após falha no envio, e são apagados após sucesso.
- Layout responsivo, dialog nativo, navegação por teclado e mensagens acessíveis.

Não há `maxlength`, limite de quantidade de anexos ou limite de tamanho imposto pelo widget. Memória do navegador e limites do servidor/proxy ainda se aplicam. A captura nativa exige HTTPS ou localhost, suporte do navegador e escolha da tela/aba pelo usuário. A alternativa mobile renderiza a página localmente com escala máxima de 2 para reduzir o uso de memória; não inclui barras do navegador ou outros aplicativos. Imagens e iframes externos dependem de CORS e das permissões de origem; vídeo e alguns efeitos visuais podem diferir. Upload e colagem continuam disponíveis para prints feitos pelo sistema operacional. Uma CSP deve permitir o script complementar na mesma origem do widget; o carregador preserva o nonce da tag original.

## Notificações no computador e no celular

Na Central online, entre como administrador e abra **Notificações**. Escolha todos os sistemas ou apenas os desejados, clique em **Ativar neste dispositivo** e permita as notificações no navegador. A ativação é independente no computador e no celular. **Enviar notificação de teste** confere a exibição pelo aparelho; **Desativar neste dispositivo** remove a inscrição. Sair da conta também desativa o recebimento nesse navegador.

Relatos confirmados com todos os anexos entram numa fila persistente. A cada minuto, o Supabase Cron chama a API da Central para enviar um resumo por dispositivo, agrupado por sistema, com a quantidade de novos relatos desde o último acesso. Confirmações repetidas não criam eventos duplicados. O resumo considera recebimentos, independentemente do status atual de correção; os indicadores de bugs pendentes continuam separados. Ao consultar a Central, a referência de leitura é atualizada nos dispositivos da mesma conta.

O push contém contagens e nomes de sistemas. O clique abre a Central com os sistemas correspondentes filtrados; textos completos e anexos continuam exigindo login. Se o navegador rejeitar uma inscrição com 404/410, ela é removida. Falhas temporárias mantêm os relatos para nova tentativa após expirar uma reserva de dois minutos. Até 100 dispositivos são processados por rodada, em grupos de dez; cada administrador pode cadastrar até dez dispositivos.

A Central pode ser instalada pelo botão **Instalar Central**, quando o navegador oferecer a instalação. No computador, a inicialização automática é uma escolha do usuário no menu do aplicativo em `chrome://apps` ou `edge://apps`. Ao abrir a Central, o resumo é recuperado do banco mesmo se uma mensagem push anterior tiver expirado. No Android, o recebimento pode funcionar com a página fechada. No iPhone, abra a Central adicionada à Tela de Início. Aviso flutuante, som e execução em segundo plano dependem das permissões e configurações do aparelho.

O Service Worker não armazena páginas nem respostas privadas. Guarda somente uma identidade local para impedir que um push de outra conta seja exibido no mesmo navegador. A instalação online exige a [migração e o agendador](DEPLOY.md#notificações-web-push-v08). Nenhuma nova variável da Vercel é necessária: as chaves VAPID e o token do agendador são criados pela API e guardados numa tabela privada, acessível somente pelo servidor.

`npm run test:notifications` verifica o SQL em PostgreSQL embarcado, a API, inscrições, filtros, criptografia/VAPID, agrupamento, recuperação de falhas, concorrência, resumo inicial, privacidade entre contas e a interface em Chromium com perfil mobile. A entrega ao serviço push e as notificações nativas são simuladas no teste automatizado; use a notificação de teste no seu aparelho para conferir o recebimento real.

## Comandos da instância

```js
feedback.open();                     // Abre mesmo com botão recolhido.
feedback.close();                    // Mantém o rascunho.
feedback.hide();                     // Recolhe na borda e fecha formulário.
feedback.show();                     // Expande o botão.
feedback.setPosition('top-left');    // Também: top-right, bottom-left, bottom-right.
feedback.destroy();                 // Remove interface, listeners e prévias.
```

A própria seta permite recuperar o botão. Opcionalmente, conecte `feedback.show()` ao menu de ajuda do SaaS. No modo de instalação automática, use `CentralBugs.instance.show()`.

## Contrato inicial de envio

Sem `transport`, o modo `endpoint` faz `POST` com `multipart/form-data`:

- `report`: string JSON com `schemaVersion`, `id`, `projectId`, `type`, `title`, `description`, `links`, `createdAt`, `context`, `attachments` e, quando fornecido, `user`.
- `attachments`: campo repetido com cada arquivo binário, na mesma ordem dos metadados de `report.attachments`.

`context` contém a URL atual (incluindo parâmetros), título da página, idioma e dimensões da janela. Revise o contexto que seu SaaS deseja compartilhar. O widget não envia senhas, cookies, logs ou HTML da página. Quando o usuário pede uma captura mobile, o DOM é lido e renderizado localmente; somente o PNG revisado é anexado. No modo legado, os dados de usuário são os fornecidos na configuração. No fluxo com ID de acesso, a API registra o e-mail confirmado pelo servidor do SaaS.

Uma resposta HTTP 2xx confirma o envio. Erros de rede ou HTTP mantêm o rascunho; a requisição é cancelada após 30 segundos. O `id` e o payload permanecem nas tentativas sem edição; editar um relato após uma falha cria outro `id`. O backend deve deduplicar envios pelo identificador. O modo callback deve implementar seu próprio timeout/cancelamento se necessário.

O servidor deve permitir CORS para as origens dos SaaS, validar os campos e arquivos e aplicar autenticação/controles de envio. `projectId` identifica o projeto; não é uma credencial. Não coloque chaves privadas no frontend. Para autenticação usando o SaaS, use um endpoint no mesmo domínio ou o callback `onSubmit` com seu cliente HTTP existente. A API online já implementa CORS por sistema, validação, controles de envio e acesso administrativo autenticado.

Com `transport: 'signed-upload'`, a API recebe JSON `{"action":"prepare","report":...}` e retorna `key`, `receipt` e `uploads` (um slot por imagem, com `url` ou `uploaded:true`). O widget faz `PUT` das imagens diretamente nas URLs e confirma via `{"action":"commit","key":...,"receipt":...}`. Uma preparação com `ready:true` indica que a ocorrência já foi confirmada em uma tentativa anterior. O timeout é de 30 segundos por chamada à API e de dois minutos por upload; destruir o widget cancela as requisições. Não use esse transporte com o servidor local.

## Verificação

O exemplo de integração com o frontend Next.js do Radar está em
[integrations/radar-contratual.md](integrations/radar-contratual.md). Há um
receptor local persistente para verificar o envio antes da definição
da Central definitiva: `npm start`. `npm run test:receiver` executa a verificação automatizada da Central em portas temporárias.

O teste de navegador em `tests/widget.cjs` verifica instalação por uma tag, arraste com mouse e toque, recolhimento nas quatro bordas, envio multipart, recuperação de falha, anexos, links, preferências, isolamento de conteúdo, captura simulada completa e recortada (dimensões e pixels), cancelamento e navegação por teclado. Para executá-lo, use Node.js 22. As dependências abaixo são apenas para desenvolvimento; o widget distribuído continua independente:

```sh
npm install
npx playwright install chromium
npm test
```

`npm run test:mobile` usa Chromium com perfil Pixel 7 (toque, DPR, viewport e agente Android), desativa explicitamente `getDisplayMedia` e captura o DOM de verdade, sem simular a imagem. Verifica rolagem, elemento fixo, CSS moderno, exclusão de senha/região privada, recorte por toque, cancelamento, rotação, recuperação de falha, envio e leitura de três PNGs no receptor e no painel mobile. Evidências ficam em `artifacts/mobile/`. A emulação não substitui validação em um aparelho físico.

Para registrar uma ocorrência de demonstração na Central local, com as portas 4173/4180 livres, execute `node tests/mobile.cjs --record`, depois `npm start`. Esse modo mantém o relato e os três anexos em `data/`; o teste normal usa uma pasta temporária. Para regenerar o renderizador empacotado após alterar sua versão, use `npm run build:capture`; `npm run build` já gera o arquivo complementar em `dist/`.

Os testes iniciam e encerram seus próprios servidores locais. `tests/build.cjs` verifica a prévia estática, seus arquivos públicos, o aviso de configuração e a ausência de envio/polling sem backend. `tests/central.cjs` verifica dois relatos enviados de outra origem ao painel, isolamento por sistema, detalhes, imagens binárias, busca, alteração de status, modo escuro, responsividade, deduplicação e recuperação após reiniciar o receptor. Nenhum teste altera a pasta real `data/`. Para usar um Chromium já instalado, informe `CHROMIUM_PATH=/caminho/do/chromium npm test`. A autorização real para captura de tela depende da interface do navegador e deve ser conferida manualmente.

## API da Central local

- `POST /reports` ou `POST /api/reports`: recebe o multipart do widget.
- `GET /api/reports`: lista os registros persistidos com `key`, `report`, `attachments`, `status` e datas.
- `DELETE /api/reports/:key`: apaga a ocorrência e seus arquivos (administrador no modo online).
- `GET/POST/PATCH /api/reports?systems=1`: consulta, cadastra e edita os sistemas (administrador).
- `POST /api/reports?widget=access`: troca o ID de integração e a identidade confirmada pelo servidor do SaaS por autorização temporária.
- `PATCH /api/reports/:key`: altera o status com JSON, por exemplo `{"status":"em-correcao"}`.
- `GET /attachments/:key/:indice`: disponibiliza a imagem armazenada.

O caminho da imagem é retornado pelo receptor; nomes de arquivos enviados não são usados como caminhos no disco. O receptor grava arquivos temporários e publica o registro por renomeação antes de responder. A implementação local usa um único processo/fila de escrita; para múltiplos processos, substitua o armazenamento por um banco transacional.

O teste `tests/cloud.cjs` usa o SDK oficial e um serviço simulado localmente para verificar login, restrição administrativa, CORS por sistema, duas imagens, confirmação com falha e retentativa, detalhes privados, busca completa, Resolver e saída da sessão. Não acessa o projeto Supabase real. `tests/build.cjs` também verifica o build com login e ausência de chave secreta nos arquivos públicos.

Para conferir o SQL em PostgreSQL embarcado, sem serviços remotos:

```sh
npm install --prefix /tmp/central-sql-check @electric-sql/pglite
PGLITE_PATH=/tmp/central-sql-check/node_modules/@electric-sql/pglite node tests/sql.cjs
```


## Cadastro de sistemas e disponibilidade (v0.10)

A Central de Sistemas cadastra empresa e sistema. Em **Quem pode usar o plugin?**, escolha **Contas específicas** (uma ou várias contas principais) ou **Todas as contas do sistema** (sem cadastrar e-mails, com sessão autenticada obrigatória). As opções anteriores são preservadas. Filtros de conta no código do SaaS precisam ser ajustados nesse projeto para respeitar essa escolha. Ela gera um ID de integração para o servidor do SaaS. O roteiro completo, incluindo autenticação, conexão do widget, verificação e remoção, está em [INTEGRACAO-PARA-IA.md](INTEGRACAO-PARA-IA.md). As ocorrências aparecem em quatro blocos por empresa: Bugs novos, Em análise, Em processamento e Terminados. Os status anteriores são preservados. É possível apagar uma ocorrência com seus anexos ou selecionar relatos terminados por data em **Apagar bugs antigos**.

A **Central de Sistemas** também permite desconectar um sistema preservando o histórico, ou excluir seu cadastro com todos os relatos e anexos. As duas ações exigem confirmação com Sim/Não. [Guia de desconexão e remoção do código](INTEGRACAO-PARA-IA.md#desconectar-ou-excluir-um-sistema).

## Atualização do widget durante o uso

Carregue `central-bugs.js` pela URL da Central. O build gera `central-bugs-version.json`; a versão 0.9 verifica publicações compatíveis a cada 60 segundos e ao voltar à aba, substituindo somente instâncias ociosas. Rascunhos, anexos e envios não são descartados. As referências `init`/`connect` e a remoção no logout continuam válidas. O popup agora tem Claro/Escuro e não inclui o campo Links; o contexto da página e relatos antigos são preservados. Detalhes de instalação, CSP e migração de cópias locais estão no [guia](INTEGRACAO-PARA-IA.md#atualizações-automáticas-do-widget).

## Contas e supervisão (v0.11)

Cada conta cadastra seus próprios sistemas. A conta principal administra todos e pode selecionar supervisores no cadastro ou na edição de um sistema. Supervisores acompanham bugs e alteram status; somente o dono e a conta principal podem apagar dados ou alterar a integração. Consulte [o guia de contas e supervisão](CONTAS-E-SUPERVISAO.md) para instalação, migração e permissões.
