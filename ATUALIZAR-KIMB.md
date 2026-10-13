# Prompt para a IA responsável pelo Kimb

Copie a mensagem abaixo para o chat que tem acesso ao repositório privado do Kimb. A alteração no SaaS é feita uma vez; depois, as publicações compatíveis do widget serão recebidas automaticamente. O administrador da Central não precisa da senha nem de acesso ao repositório do Kimb.

---

Atualize a integração da Central de Bugs no Kimb, publicado em https://kimbi-pied.vercel.app/.

A Central já mantém o cadastro e a autorização desse sistema. Preserve o ID de acesso existente no servidor, o endpoint autenticado do Kimb, os e-mails autorizados, os relatos e o ciclo de logout/troca de conta. Não gere outro ID, não cadastre outro sistema e não altere as permissões do SaaS.

O site atualmente carrega uma cópia do widget: no bundle público, o carregador define `script.src = "./central-bugs.js"` e depois usa `CentralBugs.connect`. Localize esse carregador no código-fonte (e qualquer outra tag/import que carregue uma cópia local). Troque a origem para:

```js
script.src = 'https://central-de-bugs.vercel.app/central-bugs.js';
```

Use uma única instância/carregador. Preserve a chamada existente a `CentralBugs.connect`, o endpoint de acesso no próprio Kimb, os cabeçalhos da sessão, o AbortController e a destruição do widget no logout. Não substitua o fluxo autenticado por `CentralBugs.init` ou por `data-project-id`. Mantenha o tratamento de falhas sem bloquear o Kimb. Se houver CSP, autorize https://central-de-bugs.vercel.app em script-src e connect-src preservando as demais regras; repasse o nonce existente. Não fixe um hash SRI para a URL mutável do widget.

Não copie os arquivos novos para public/ do Kimb: a Central já hospeda o widget, `central-bugs-version.json` e o renderizador de captura mobile. Remova arquivos locais apenas depois de confirmar que nenhum carregador/import os usa.

Leia o guia antes de alterar a integração:
https://github.com/Ioseph-Hughes/Central-de-Bugs/blob/main/INTEGRACAO-PARA-IA.md#atualizações-automáticas-do-widget

A versão 0.9 ou posterior verifica o manifesto a cada 60 segundos com a aba visível e ao voltar à aba. Uma publicação compatível troca apenas widgets ociosos, preservando rascunhos (mesmo com o popup fechado), imagens, capturas e envios. As referências de init/connect permanecem válidas: destroy e AbortController continuam removendo a versão atual. O popup tem botão Claro/Escuro e não inclui o campo Links. A URL da página continua em context.url e os relatos antigos permanecem intactos.

Execute os checks aplicáveis do repositório e publique a alteração. Depois, recarregue a página uma vez para carregar a nova versão. Verifique:

1. O script é recebido de https://central-de-bugs.vercel.app/central-bugs.js e o manifesto é consultado nessa mesma origem, sem erros de CSP/CORS.
2. A conta já autorizada vê um único botão. Uma conta sem autorização não vê o widget. Logout/troca de conta o remove, inclusive após uma atualização.
3. O popup alterna Claro/Escuro sem alterar o tema do Kimb e mantém a preferência ao recarregar. O campo Links não existe.
4. Um relato de teste mantém o mesmo cadastro do Kimb na Central e usa a autenticação existente. Identifique-o como teste; não apague relatos existentes para validar.
5. A versão em `CentralBugs.version` corresponde ao campo release do manifesto. A atualização de interface não recarrega o Kimb e espera o fim de um relato/captura/envio.

Informe os arquivos alterados, as verificações executadas e o endereço do deploy. Não envie segredos nem valores de variáveis do servidor na resposta.
