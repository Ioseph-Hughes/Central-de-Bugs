# Central de Bugs · v0.2

Widget de feedback reutilizável, em JavaScript puro, sem instalação de pacotes ou etapa de build. A interface fica em um Shadow DOM para isolar seus estilos do SaaS.

## Testar agora

Na pasta do projeto:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Abra http://localhost:4173. A demonstração recebe relatos **apenas na memória da página**; recarregar apaga os relatos. O plugin não contém um backend nem armazena relatos em um servidor.

## Instalar em um SaaS

Copie `central-bugs.js` para os arquivos públicos do seu frontend e adicione uma única tag HTML. O botão aparece automaticamente:

```html
<script defer
  src="/central-bugs.js"
  data-project-id="portal-cliente"
  data-endpoint="https://sua-central.com/api/relatos"
></script>
```

O identificador é obrigatório; o endereço de envio pode ser definido quando a Central estiver pronta. Opcionalmente, `data-position="top-left"` define o canto inicial. A instância automática fica disponível em `CentralBugs.instance`.

Para fornecer dados de usuário ou usar um callback, carregue o script sem `data-project-id` e inicialize manualmente depois do carregamento do DOM:

```html
<script src="/central-bugs.js"></script>
<script>
  const feedback = CentralBugs.init({
    projectId: 'portal-cliente',
    endpoint: 'https://sua-central.com/api/relatos',
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
- Upload, colagem de prints e captura nativa da tela.
- Arraste o botão pela alça ou pelo próprio texto. Solte junto a uma borda (até 32 px) para recolher; solte no interior para mantê-lo expandido.
- Recolhido, mostra somente uma seta apontando para dentro da tela. Clique para expandir ou arraste a seta até outra posição/borda, inclusive nos cantos. Também há um botão de recolher e escolha de cantos pelo menu, acessíveis por teclado.
- Posição proporcional à janela, borda e estado recolhido persistem no navegador por projeto e se ajustam a mudanças de resolução. Texto e anexos ficam somente na memória, preservados ao fechar o formulário ou após falha no envio, e são apagados após sucesso.
- Layout responsivo, dialog nativo, navegação por teclado e mensagens acessíveis.

Não há `maxlength`, limite de quantidade de anexos ou limite de tamanho imposto pelo widget. Memória do navegador e limites do servidor/proxy ainda se aplicam. A captura nativa exige HTTPS ou localhost, suporte do navegador e escolha da tela/aba pelo usuário; upload e colagem continuam disponíveis.

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

O modo `endpoint` faz `POST` com `multipart/form-data`:

- `report`: string JSON com `schemaVersion`, `id`, `projectId`, `type`, `title`, `description`, `links`, `createdAt`, `context`, `attachments` e, quando fornecido, `user`.
- `attachments`: campo repetido com cada arquivo binário, na mesma ordem dos metadados de `report.attachments`.

`context` contém a URL atual (incluindo parâmetros), título da página, idioma e dimensões da janela. Revise o contexto que seu SaaS deseja compartilhar. O widget não coleta senhas, cookies, logs ou conteúdo do DOM. Os dados de usuário são somente os fornecidos na configuração.

Uma resposta HTTP 2xx confirma o envio. Erros de rede ou HTTP mantêm o rascunho; a requisição é cancelada após 30 segundos. O `id` do rascunho permanece nas novas tentativas: o backend deve usá-lo para evitar duplicatas quando uma resposta se perder. O modo callback deve implementar seu próprio timeout/cancelamento se necessário.

O servidor deve permitir CORS para as origens dos SaaS, validar os campos e arquivos e aplicar autenticação/controles de envio. `projectId` identifica o projeto; não é uma credencial. Não coloque chaves privadas no frontend. Para autenticação usando o SaaS, use um endpoint no mesmo domínio ou o callback `onSubmit` com seu cliente HTTP existente. Este contrato pode ser adaptado quando a Central for definida.

## Verificação

O teste de navegador em `tests/widget.cjs` verifica instalação por uma tag, arraste com mouse e toque, recolhimento nas quatro bordas, envio multipart, recuperação de falha, anexos, links, preferências, isolamento de conteúdo, captura simulada e navegação por teclado. Para executá-lo, use Node.js 20 ou superior. As dependências abaixo são apenas para desenvolvimento; o widget distribuído continua independente:

```sh
npm install
npx playwright install chromium
npm test
```

O teste inicia e encerra seu próprio servidor local. Para usar um Chromium já instalado, informe `CHROMIUM_PATH=/caminho/do/chromium npm test`. A autorização real para captura de tela depende da interface do navegador e deve ser conferida manualmente.
