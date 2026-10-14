# Integrar um sistema à Central de Bugs — guia para qualquer IA

Este arquivo é o contrato de integração da versão 0.10. Leia-o antes de alterar o SaaS. O plugin identifica cada sistema pelo cadastro na Central, independentemente do chat, conta de IA ou modelo usado para instalá-lo.

## 1. Objetivo e informações recebidas

A Central reúne bugs, melhorias e ajustes dos sistemas de uma empresa. O widget permite escrever relatos, anexar várias imagens, capturar a tela inteira ou recortar uma área. O painel mantém quatro etapas por empresa: **Bugs novos → Em análise → Em processamento → Terminados**.

Você receberá:

- A URL da Central (por exemplo, `https://central-de-bugs.vercel.app`).
- O **ID de acesso** gerado no cadastro, começando com `cb_`.
- A disponibilidade escolhida: **Contas específicas**, com um ou vários e-mails, ou **Todas as contas do sistema**, sem lista de e-mails.
- O repositório do SaaS a integrar.

O ID identifica e autoriza o servidor desse SaaS. O e-mail confirmado identifica o autor do relato e, no modo de contas específicas, também é conferido na lista autorizada. Nenhuma informação do chat é usada para identificar os relatos.

## 2. Preparar o cadastro e o ambiente

1. Na Central, abra **Central de Sistemas → Cadastrar sistema**.
2. Informe empresa e nome do sistema. Em **Quem pode usar o plugin?**, escolha **Contas específicas** e informe os e-mails (um por linha), ou **Todas as contas do sistema**; nessa opção os e-mails são dispensados. Todas significa todas as contas autenticadas, nunca visitantes.
3. Opcionalmente informe os domínios, com protocolo, sem caminho ou barra final. Cada domínio precisa de uma linha; `https://site.com` e `https://www.site.com` são distintos.
4. Salve, guarde o ID mostrado e copie as instruções. A Central guarda somente o hash desse ID; ele não é recuperável. Se perdido, gere outro na edição do cadastro.
5. No ambiente **do servidor do SaaS**, configure:

```dotenv
CENTRAL_BUGS_ORIGIN=https://central-de-bugs.vercel.app
CENTRAL_BUGS_ACCESS_ID=cb_ID_RECEBIDO_NO_CADASTRO
SAAS_ORIGIN=https://www.seusistema.com
```

**Nunca use `NEXT_PUBLIC_`, `VITE_`, código HTML, localStorage ou bundle do navegador para o ID de acesso.** O ID não é a chave do Supabase nem a senha do administrador da Central.

Se os domínios ficaram vazios, a primeira autorização válida do servidor registra `SAAS_ORIGIN`. Para adicionar outros domínios, edite o cadastro. Use o endereço real do SaaS, nunca o endereço da Central. Em desenvolvimento, HTTP é aceito somente para localhost/127.0.0.1.

## 3. Criar um endpoint de acesso no servidor do SaaS

Crie um endpoint, por exemplo `POST /api/central-bugs/access`, usando a infraestrutura existente. Ele deve:

1. Confirmar a sessão atual com o provedor de autenticação **no servidor**.
2. Obter o e-mail da conta autenticada, verificando que pertence ao usuário e foi confirmado pelo provedor.
3. Enviar esse e-mail, `SAAS_ORIGIN` e o ID secreto à Central.
4. Devolver a autorização temporária recebida, sem expor o ID secreto.
5. Responder 401/403 para sessão ausente ou conta não autorizada. Usar `Cache-Control: no-store` em todas as respostas.

**Não aceite `email` vindo do body/query/localStorage como identidade. Não confie em uma comparação de e-mail apenas no frontend. Não altere as políticas de autenticação/RLS do SaaS para instalar o widget.**

### Exemplo: Next.js App Router com Supabase Auth existente

Arquivo `app/api/central-bugs/access/route.ts`. Adapte os nomes das variáveis públicas do Supabase às já usadas no projeto. Este exemplo usa sessão enviada por Bearer; para cookies, use o cliente de autenticação de servidor já existente no SaaS e preserve a mesma verificação.

```ts
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  const reply = (value: unknown, status: number) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const central = process.env.CENTRAL_BUGS_ORIGIN;
    const accessId = process.env.CENTRAL_BUGS_ACCESS_ID;
    const origin = process.env.SAAS_ORIGIN;
    if (!central || !accessId || !origin) return reply({ error: 'Integração não configurada.' }, 503);
    if (request.headers.get('origin') && request.headers.get('origin') !== origin)
      return reply({ error: 'Origem inválida.' }, 403);
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return reply({ error: 'Entre no sistema.' }, 401);
    const auth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // ou a variável da chave publicável já existente
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user?.email || !data.user.email_confirmed_at)
      return reply({ error: 'Conta não confirmada ou sessão inválida.' }, 401);
    const response = await fetch(`${central}/api/reports?widget=access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessId, email: data.user.email, origin }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store'
    });
    // Não encaminhar o header Origin nesta troca entre servidores.
    const payload = await response.json();
    if (!response.ok) return reply({ error: 'Conta não autorizada ou integração indisponível.' }, response.status);
    return reply(payload, 200);
  } catch {
    return reply({ error: 'Integração indisponível.' }, 503);
  }
}
```

Se o projeto não usa Supabase, substitua a verificação por sua autenticação atual, mantendo o e-mail confirmado obtido no servidor. Nunca use chave secreta do Supabase da Central no SaaS.

### Contrato da troca entre servidores

```http
POST https://SUA_CENTRAL/api/reports?widget=access
Content-Type: application/json

{"accessId":"cb_...","email":"conta-autenticada@empresa.com","origin":"https://www.seusistema.com"}
```

Resposta 200: `{ projectId, endpoint, transport, user: { email }, token }`.

O `token` vale 15 minutos, está vinculado ao sistema, conta e domínio e só permite o envio de relatos. O endpoint verifica as contas novamente em cada envio. No modo específico, remover um e-mail invalida o acesso correspondente. Mudar de todas as contas para contas específicas bloqueia os usuários excluídos na próxima autorização ou envio, inclusive tickets emitidos anteriormente. Mudar domínios ou renovar o ID também invalida o acesso correspondente. O plugin renova essa autorização antes de preparar e concluir um envio; uma descrição longa não precisa ser apagada quando o token expirar.

## 4. Carregar o widget somente após a autenticação do SaaS

Carregue `https://SUA_CENTRAL/central-bugs.js` e use **`CentralBugs.connect`**. Não inclua `data-project-id` no script: esse atributo inicia o modo antigo automaticamente.

**Para receber atualizações automáticas, carregue o arquivo pela URL da Central. Não copie o widget para `public/` do SaaS nem fixe sua versão com uma cópia compilada.** O carregador de captura mobile também é obtido dessa origem somente quando necessário. Se houver CSP, permita a origem da Central em `script-src` e `connect-src`; o nonce da tag original é preservado na atualização. Não use SRI com hash fixo para essa URL mutável. Uma instalação isolada/offline precisa publicar o widget, o renderizador de captura e o manifesto juntos e administrar suas próprias atualizações.

```js
// Depois de carregar o script, usando o cliente Supabase já existente no SaaS:
const lifecycle = new AbortController();
const feedback = await window.CentralBugs.connect({
  accessEndpoint: '/api/central-bugs/access',
  signal: lifecycle.signal,
  accessHeaders: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  }
});
// feedback é null para contas sem permissão; nenhum botão é criado.
// Para remover ao sair, trocar de conta ou desmontar a página:
lifecycle.abort();
feedback?.destroy();
```

`getSession()` aqui fornece o token para o servidor, que o valida com `getUser()`. O resultado do navegador sozinho não libera acesso.

Integre no ciclo de vida do projeto:

- Chame `connect` para qualquer conta autenticada e deixe a Central decidir a permissão. Não fixe uma lista de e-mails ou um filtro de conta mãe/perfil no frontend ou endpoint do SaaS, pois isso impediria a opção **Todas as contas** de funcionar. Isso não altera os papéis e permissões das outras funcionalidades do SaaS.

- Mantenha uma única instância por conta autenticada; não crie outra a cada renderização ou renovação de token.
- No logout ou troca de usuário, aborte imediatamente o ciclo anterior e destrua o widget. Crie um novo ciclo para a nova conta.
- Se a autorização/script estiver carregando, impeça uma resposta atrasada de montar o widget após logout. Use AbortController e uma revisão/identificador do usuário no componente.
- Desinscreva observadores de autenticação ao desmontar. Em Supabase, não faça chamadas assíncronas ao próprio Auth dentro de `onAuthStateChange`; agende a verificação fora do callback, seguindo o padrão já usado no SaaS.
- Aguarde o carregamento do script antes de chamar `connect`. Trate falhas sem bloquear as funcionalidades normais do SaaS.
- Não instale `init({user:{email:...}})` como substituto do fluxo de autorização: isso não identifica a conta com segurança.

Se houver CSP, autorize a Central em `script-src` e `connect-src`, e o domínio Supabase de armazenamento da Central em `connect-src` para upload. Preserve as outras restrições existentes. Captura de tela usa a permissão nativa do navegador e exige HTTPS.

## 5. Conferir e concluir o cadastro

1. Publique as variáveis e o endpoint no servidor do SaaS.
2. Em **Contas específicas**, entre em uma conta cadastrada: o widget deve aparecer uma vez; uma conta fora da lista deve ser recusada. Em **Todas as contas**, confira duas contas autenticadas diferentes, ambas com o widget.
3. Em ambos os modos, visitantes sem sessão não podem receber autorização; um envio direto sem ticket deve retornar 403. Confira também que outro domínio não é aceito.
4. Saia da conta permitida: o botão e qualquer formulário aberto devem desaparecer.
5. Envie um relato com texto e duas imagens; confira na Central a empresa e o sistema corretos.
6. Avance pelas quatro etapas, recarregue e confirme a persistência.
7. Na **Central de Sistemas**, o cadastro passa a indicar **Conectado** depois da primeira autorização válida. Essa indicação confirma a troca entre servidores; o envio de teste confirma o funcionamento completo.
8. Altere de todas as contas para contas específicas e confira que a próxima autorização/envio de uma conta fora da lista é recusada. Não é necessário trocar o ID para mudar a disponibilidade.

A instalação é removível: retire o componente/script, o endpoint e as variáveis do SaaS. Os relatos já enviados permanecem na Central até serem apagados pelo administrador.

## 6. Compatibilidade e operação da Central

As integrações anteriores à versão 0.6 permanecem no modo antigo, controladas pelo próprio SaaS. **Cadastrar um novo sistema não modifica automaticamente um SaaS existente.** Para migrá-lo, edite seu registro e configure o endpoint descrito neste guia. Ao salvar contas em um registro antigo, ele passa a exigir autorização; publique a mudança no SaaS junto dessa ativação.

Em instalações Supabase existentes, execute `supabase/migrations/006-systems.sql` se ainda não aplicada e `supabase/migrations/20261014005611_optional_account_scope.sql` antes do deploy da Central. A nova coluna `all_accounts` começa como `false`, preservando as escolhas anteriores. Em uma instalação nova, use `supabase/setup.sql`, que já inclui a estrutura completa.

A ação **Apagar** remove a ocorrência e seus arquivos do armazenamento ativo da Central. **Apagar bugs antigos** permite selecionar relatos terminados recebidos antes da data escolhida, dentro do sistema selecionado (ou todos), no histórico carregado de até 1.000 ocorrências. A busca e os filtros da lista não limitam essa seleção; a empresa/sistema e a data delimitam os candidatos. A confirmação é obrigatória na interface.

### Alterar a disponibilidade em uma integração existente

Edite o cadastro na Central e escolha a disponibilidade. Nas integrações que já chamam `CentralBugs.connect` para qualquer usuário autenticado, o servidor aplica a política sem republicar o SaaS nem trocar o ID. A nova política é conferida na próxima autorização ou envio. Para uma conta que ainda não tinha widget, recarregue a página para tentar conectar.

**Um filtro de conta mãe/e-mail/perfil dentro do código do SaaS continua valendo até ser ajustado nesse projeto.** Selecionar todas na Central não remove esse filtro remoto. Integrações antigas com `init` devem primeiro migrar para o fluxo de ID e endpoint autenticado. Peça à IA responsável para remover somente o filtro exclusivo do plugin, manter a autenticação e chamar `connect` para todas as contas com sessão válida.

## Desconectar ou excluir um sistema

Na **Central de Sistemas**, cada cadastro oferece **Desconectar do sistema** e **Deletar sistema**. Ambas abrem uma confirmação com **Sim** e **Não**; cancelar não altera nenhum dado.

- **Desconectar do sistema** revoga o ID e as autorizações, bloqueia novos relatos e preserva o cadastro, os relatos e as imagens. O widget hospedado verifica a disponibilidade ao carregar, a cada 30 segundos com a aba visível e ao voltar para a aba, removendo o botão quando o sistema foi desconectado ou excluído. Uma aba que carregou uma versão anterior do JavaScript precisa ser recarregada. Para reconectar, configure as contas, gere um novo ID e substitua a variável correspondente no servidor do SaaS.
- **Deletar sistema** primeiro desativa os envios, depois remove todos os relatos do sistema (incluindo rascunhos reservados), seus anexos e o cadastro. A limpeza online usa lotes e não depende dos filtros da tela nem do limite de 1.000 relatos da listagem. Em falha, a tela informa que a limpeza pode ser parcial, mantém o cadastro desativado e permite repetir a confirmação para concluir. Outros sistemas e suas ocorrências permanecem intactos. A exclusão remove os dados do armazenamento ativo; cópias, backups e arquivos já baixados não são alterados.

A Central não possui acesso de escrita aos repositórios dos SaaS. **Desconectar não apaga código remoto**. Para retirar também os arquivos da integração, envie ao chat responsável pelo SaaS:

> Remova a integração da Central de Bugs deste sistema. Localize o carregador de `central-bugs.js`, o componente que chama `CentralBugs.init` ou `CentralBugs.connect`, o endpoint de autorização exclusivo do plugin e suas variáveis `CENTRAL_BUGS_*`. Desmonte o widget e remova somente os arquivos, imports e observadores exclusivos dessa integração. Preserve a autenticação, os dados, os endpoints compartilhados e as outras funcionalidades do SaaS. Execute os checks do projeto e publique a remoção.

Não remova automaticamente bibliotecas compartilhadas (como Supabase) nem altere contas, RLS ou dados jurídicos do SaaS.

## Atualizações automáticas do widget

A partir da versão 0.9, o widget consulta `central-bugs-version.json` a cada 60 segundos com a aba visível e ao voltar para ela. O build calcula a identidade da publicação a partir do widget e do renderizador de captura e inclui a mesma identidade no script e no manifesto. Uma alteração nesses arquivos é detectada sem depender de o desenvolvedor lembrar de incrementar um número manual.

Quando encontra uma publicação compatível, o plugin carrega o script novo da mesma origem. Cada instância é substituída somente quando está ociosa: sem popup aberto, texto de rascunho (mesmo com o popup fechado), imagens, arraste, captura ou envio em andamento. Fechar um rascunho não o descarta. Ao terminar o envio e fechar o formulário, a atualização pendente pode ser aplicada. Posição, recolhimento e tema claro/escuro permanecem na preferência por sistema.

As referências retornadas por `init` e `connect` continuam válidas. O SaaS pode continuar chamando `feedback.open()` e `feedback.destroy()` depois de atualizar; o `AbortController` de logout também remove a versão atual. A atualização não modifica IDs de acesso, contas, permissões, registros nem endpoints do SaaS. Uma conta desconectada ou uma instância destruída não é remontada por uma publicação que terminou de baixar depois do logout. Falha de rede/CSP mantém a instância em uso e será tentada novamente. Publicações de protocolo incompatível exigem atualização da integração.

**Ativação inicial:** quem está com uma versão anterior à 0.9 já aberta precisa recarregar essa página uma vez. Depois que carregar a 0.9, passa a receber as próximas versões compatíveis sem recarregar o SaaS.

**Migrar uma instalação que usa cópia local:** procure o carregador de `central-bugs.js` e altere somente sua origem para `https://central-de-bugs.vercel.app/central-bugs.js`. Preserve `CentralBugs.connect`, o endpoint de autorização, o ID secreto no servidor e o ciclo de autenticação existente. Remova a cópia local somente se nenhum carregador a estiver usando. Publique o SaaS, recarregue a página e teste uma conta permitida e outra bloqueada. Não exponha o ID no navegador nem substitua a autorização por `init`.

O popup oferece um botão **Claro/Escuro** independente do tema do SaaS. O campo **Links** foi retirado dos relatos novos; a URL da página continua registrada automaticamente em `context.url`, e os links de relatos antigos permanecem nos detalhes.

Para a instalação existente do Kimb que usa uma cópia local, há um [prompt pronto para a IA responsável](ATUALIZAR-KIMB.md). Ele altera o carregador sem recriar o cadastro nem expor credenciais.
