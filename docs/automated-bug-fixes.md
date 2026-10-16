# Correção opcional de bugs com Codex

## Uso

No formulário **Relatar um bug**, clique em **Resolver imediatamente**, preencha os
detalhes opcionais e envie. O botão é um seletor (`aria-pressed`), começa desligado
e volta a desligar depois de enviar. Fechar o formulário ou falhar no envio mantém
o rascunho e a escolha. Melhoria e ajuste seguem o fluxo normal.

**Todas as contas que já podem cadastrar relatos têm essa opção. Não há vínculo
GitHub por usuário, plano especial ou nova lista de usuários para o Codex.** As regras
existentes de acesso ao sistema, sessão e origem continuam valendo. Não altera a
lista de contas autorizadas a usar um sistema já configurado como restrito.

O botão solicita uma tentativa; não promete solução instantânea. Revisão e merge
continuam humanos. A Central não marca o bug como resolvido automaticamente.

O texto selecionado vai para o repositório configurado pelo administrador. Em
repositórios públicos, ele será público. Remova dados pessoais e segredos antes de
enviar. Imagens, PDFs, identidade, e-mail do usuário, links extras e URLs assinadas
do Storage não são enviados ao GitHub. Campos de texto e URL da página passam por
sanitização; a URL perde credenciais, query string e fragmento. Senhas/tokens em
formatos conhecidos, headers de cookies/autorização, chaves privadas, e-mails, IPs
e CPF são removidos. A sanitização não reconhece todo segredo ou dado pessoal
possível em linguagem natural ou caminhos de URL. Campos longos são abreviados.

## Fluxo implementado

1. O widget envia `autoFix: true` e `diagnostics` no contrato existente. Desligado,
   preserva o payload anterior. O servidor valida o tipo, autenticação e origem.
2. O relato e todos os anexos são confirmados no Supabase antes da chamada GitHub.
   Uma falha na automação não desfaz o cadastro do bug nem exige reenviar anexos.
3. O servidor consulta `BUGFIX_REPOSITORIES`, reserva uma tarefa em PostgreSQL e
   usa um GitHub App com **Issues: write** para abrir uma Issue com `bug`. Guarda
   o número, depois adiciona `codex-fix`, gerando o evento `issues.labeled`.
4. O workflow aceita somente esse evento do bot configurado, em Issue do próprio
   bot, aberta, com os dois rótulos e o marcador da Central. PRs e outros usuários
   são recusados. O gate grava um comentário de tentativa; não há segunda execução
   paga por simples reaplicação do rótulo ou reexecução pelo botão do GitHub.
5. O job Codex usa checkout do commit confiável da branch padrão, credenciais do
   checkout desativadas, token GitHub somente de leitura, `:workspace`,
   `drop-sudo`, CLI fixada e proxy da ação oficial para a chave OpenAI. Não recebe
   chave Supabase, App de publicação, credenciais do SaaS ou produção. A ação é a
   última etapa desse runner e retorna um JSON com patch ou impedimento.
6. Outro runner transporta esse JSON como artefato. O job de verificação baixa o
   artefato, valida tamanho, caminhos e modos e aplica o patch no commit original.
   Um contêiner descartável roda **sem rede, segredos ou mounts do host**:
   `npm test`, `npm run test:sql`, `npm run build` e novos testes `tests/codex-*.cjs`.
   Dependências são instaladas antes, com `npm ci --ignore-scripts`. Não existem
   comandos de lint/type-check neste projeto JavaScript; não foram inventados.
7. Só depois do sucesso, outro runner valida novamente o mesmo patch e cria
   `codex/issue-N`, commit e PR **draft** contra a branch padrão, com
   `codex-generated` e `Closes #N`. A descrição separa o relato do agente dos
   testes executados pelo workflow. O job usa outro App e **não executa código da
   proposta**, hooks Git nem scripts do pacote. Nunca faz force-push ou merge.

O uso de Apps evita depender de eventos recursivos emitidos pelo `GITHUB_TOKEN`.
A CI adicionada roda também no PR criado pelo App. As branches `codex/*` têm
deploy automático da Vercel desativado em `vercel.json`. Outros provedores ou
workflows de deploy devem receber uma restrição equivalente pelo administrador.

## Instalação pelo administrador

O código foi preparado localmente. Em 15/10/2026, após o pedido de ativação, a
migração foi aplicada no projeto Supabase **Central de Bugs** pela conexão
disponível e registrada remotamente como `20261015210423_automated_bug_fixes`.
A verificação confirmou RLS ativa, acesso à tabela/RPC somente pelo servidor e
nenhum acesso de `anon` ou `authenticated`. O aviso informativo de RLS sem
políticas é esperado para essa tabela exclusiva do servidor.

A conexão Vercel foi confirmada no projeto `central-de-bugs`, da equipe
`ioseph-hughes`. As quatro variáveis existentes de Supabase/origem estão
cadastradas em produção; seus valores secretos não foram lidos. As variáveis
`BUGFIX_APP_ID`, `BUGFIX_APP_PRIVATE_KEY` e `BUGFIX_REPOSITORIES` ainda não existem.

O acesso GitHub foi corrigido selecionando a conta já autenticada
`Ioseph-Hughes` no GitHub CLI; a conta anteriormente ativa era `MVPcontratos`.
A API confirmou escrita e administração do repositório para a conta selecionada.
Não foi necessário reinstalar o plugin nem ampliar permissões de tokens.

A integração completa ainda não está ativa: Apps, seus segredos e a chave OpenAI
continuam pendentes. O repositório não possui Actions Secrets ou Variables
cadastrados. A proteção da principal foi aplicada e verificada: PR com uma
aprovação humana, check `test` do GitHub Actions, branch atualizada, regras
também para administradores, sem force-push ou exclusão e com resolução das
conversas obrigatória. Nenhum merge ou deployment foi feito nesta etapa.

O cadastro dos Apps foi aberto na conta `Ioseph-Hughes`, mas o GitHub exigiu
confirmação da identidade por e-mail (sudo mode). Essa confirmação está pendente
na aba do navegador. O App de recebimento e o App de publicação ainda não foram
criados. A integração OpenAI Developers foi sugerida para permitir a configuração
da chave API pela conexão oficial, mas ainda não está confirmada nesta sessão.

### 1. Banco

Em uma instalação nova, execute `supabase/setup.sql` e depois
`supabase/migrations/20261015204835_automated_bug_fixes.sql` no SQL Editor. Em
instalações existentes, execute apenas essa migração depois das migrações já
necessárias à sua versão. Ela é idempotente. Não modifica os relatos existentes.

A tabela `central_bug_fix_jobs` tem RLS, nenhum acesso para `anon`/`authenticated`
e uma RPC reservada a `service_role`. Sem acesso direto do navegador. A chave
secreta existente continua exclusivamente no servidor. A migração foi verificada
em PostgreSQL embarcado; aplicar no projeto remoto permanece uma etapa manual.

### 2. App de recebimento na Vercel

Crie um GitHub App exclusivo para o recebimento, com **Repository permissions →
Issues: Read and write** e Metadata somente de leitura, sem Contents/Actions/
Administration write. Não precisa configurar webhook ou OAuth de usuários.
Instale **somente nos repositórios que receberão relatos**. Gere sua chave privada
no GitHub e guarde-a no gerenciador de segredos da Vercel.

| Variável Vercel | Valor |
| --- | --- |
| `BUGFIX_APP_ID` | ID real do App de recebimento |
| `BUGFIX_APP_PRIVATE_KEY` | PEM integral; aceita quebras de linha reais ou `\n` |
| `BUGFIX_REPOSITORIES` | JSON com ID do sistema → repositório e instalação |

Formato, com placeholders a substituir pelos valores reais:

```json
{
  "ID_REAL_DO_SISTEMA": {
    "repository": "DONO/REPOSITORIO",
    "installationId": "ID_NUMERICO_DA_INSTALACAO"
  }
}
```

Use o ID exibido pela Central de Sistemas, o caminho exato do repositório do
**sistema afetado** e o installation ID do App, não o App ID. O token é criado
com escopo de um repositório e somente Issues write. Não há token no frontend.
Cada sistema precisa de mapeamento; um relato não escolhe outro repositório.
As variáveis Supabase e `CENTRAL_ORIGIN` existentes permanecem necessárias.

### 3. Workflows e segredos em cada repositório de destino

No GitHub, crie previamente os rótulos `bug`, `codex-fix` e `codex-generated`.
Habilite Actions e permita as ações fixadas no workflow.

| Local | Nome | Valor/permissão |
| --- | --- | --- |
| Actions Secret | `OPENAI_API_KEY` | Chave de projeto OpenAI para esse uso, com limites e alertas de custo |
| Actions Variable | `BUGFIX_BOT_LOGIN` | Login exato do App de recebimento, incluindo `[bot]` |
| Actions Variable | `BUGFIX_PUBLISH_APP_ID` | ID do App separado de publicação |
| Actions Secret | `BUGFIX_PUBLISH_APP_PRIVATE_KEY` | Chave PEM do App de publicação |
| Actions Variable opcional | `BUGFIX_MODEL` | Modelo Codex disponível para sua chave; vazio usa o padrão da CLI |

Crie o **App de publicação separado**, instalado somente nesse repositório, com
**Contents: write**, **Pull requests: write**, **Issues: write** e Metadata read.
Não dê Actions, Administration, Workflows, Secrets ou Deployments write. A ação
de criação do token solicita essas três permissões e revoga o token ao terminar.
A chave do App de publicação e a OpenAI **não ficam na Vercel**. A chave do App de
recebimento **não fica nos jobs do GitHub**.

Nesta Central, os arquivos já estão implementados. Para direcionar bugs de outro
SaaS, instale o workflow/prompt/schema/verificador no repositório desse SaaS e
adapte **em revisão humana** o Dockerfile, os comandos e a política de caminhos à
tecnologia dele. O workflow atual foi feito para esta Central Node.js 22/npm;
não detecta nem inventa os testes de outros projetos. Só adicione o mapeamento
depois dessa instalação. Um rótulo não executa um workflow ausente na branch
padrão. Mudanças desta implementação precisam ser revisadas e incorporadas pela
equipe antes da ativação; não houve push ou merge nesta tarefa.

### 4. Proteger a main

Crie/confira uma ruleset para a branch padrão: exigir PR, pelo menos uma aprovação
humana, CI `CI / test`, sem force-push, sem exclusão e sem bypass para os Apps.
Exija também que a branch esteja atualizada com a principal antes do merge.
Não coloque nenhum App na lista de bypass. Garanta que a integração Vercel não
publique previews das branches Codex (a configuração local já exclui `codex/*`).
Esta sessão confirmou `main` como padrão e repositório público. A proteção foi
aplicada via API e conferida com a conta proprietária. O check obrigatório é
`test`, vinculado ao App GitHub Actions de ID `15368`; exige branch atualizada e
uma aprovação, inclusive para administradores. Não há permissão de force-push ou
exclusão. Somente o proprietário consta atualmente como colaborador: para aprovar
PRs escritos por essa conta, outro membro precisará de acesso de escrita. Os
logins dos membros devem ser informados pelo administrador; não foram inventados
nem enviados convites nesta tarefa.

## Limites e recuperação

- Até **5 solicitações novas por sistema em 24 horas** e **20 por repositório em
  24 horas**, persistentes em SQL; tentativas falhas também contam. Não há lista
  adicional de contas autorizadas para a funcionalidade.
- Deduplicação por sistema, repositório e conteúdo sanitizado (título, descrição,
  passos, resultados, página/módulo, logs e versão), independentemente do ID do
  relato/usuário. É permanente enquanto a tarefa existir, inclusive se a Issue
  fechar. Para um bug novo ou recorrente, descreva a diferença/contexto novo.
  Quotas do cadastro de relatos existentes continuam aplicadas.
- Um workflow por Issue por vez; gate recusa reaplicações e `run_attempt > 1`.
  Codex até 25 minutos; verificação até 25; gate/publicação até 5. API GitHub tem
  timeouts de 7 segundos no recebimento. Patch até 180 KB/20 arquivos; artefatos
  expiram em três dias. Há também limites de outputs do próprio GitHub Actions;
  propostas ausentes ou filtradas pelo GitHub falham sem publicar.
- São bloqueados CI, instruções de agentes, arquivos ocultos, pacotes/lockfiles,
  SQL, scripts, autenticação compartilhada, configurações e testes existentes.
  Somente fontes JS/CJS/CSS/HTML da raiz/api e regressões novas
  `tests/codex-*.cjs` são elegíveis; há exclusões adicionais no verificador.
  Bugs que exigirem esses arquivos devem ser corrigidos pelo desenvolvimento
  normal. O agente não deve enfraquecer validações de segurança nos fontes.
- Não há fila com retentativa cega. Se o processo cair depois de reservar a
  tarefa, ela permanece `creating`; timeout após um POST vira `uncertain`.
  Isso evita criar duas Issues quando a primeira foi aceita mas a resposta se
  perdeu. Estado `queued` significa Issue rotulada, não garante que o workflow
  esteja habilitado ou que a OpenAI tenha aceitado uma execução.
- Acompanhe o link da Issue nos detalhes da ocorrência e a aba Actions.
  `failed` antes do POST indica erro de configuração/token; `uncertain` requer
  verificar Issues pelo marcador `central-bug-fix:<fingerprint>` e o número salvo.
  Não exclua/reinicie tarefas sem conferir o resultado remoto.
- Se a Issue já existe e falta o rótulo, um administrador pode recuperá-la usando
  **o App de recebimento**, mantendo o remetente confiável exigido pelo gate.
  Uma adição manual pelo usuário não dispara a tentativa paga.
- Para repetir uma tentativa já iniciada, analise a falha primeiro. Com o workflow
  desativado, confira branch/PR existentes e o log. Somente se não houver proposta
  a preservar, remova o comentário marcador do `github-actions[bot]`; reative e
  reaplique o rótulo usando o App. Isso é uma operação administrativa deliberada,
  não uma retentativa automática. Branch ou PR existente continua bloqueando
  duplicação. Prefira corrigir/revisar a proposta existente com Codex ou Claude.
- Falhas posteriores ao push podem deixar branch ou PR draft sem rótulo. O job
  de erro registra o link da execução. Recupere manualmente; nunca sobrescreva.

Não há acesso à OpenAI no modo `npm start`: ele salva o relato e informa que a
correção requer a Central online configurada. Relatos legados anônimos online
continuam no fluxo existente, mas precisam de uma sessão válida com acesso ao
sistema para solicitar execução paga. A identidade declarada em `report.user`
não é usada como autorização. As instalações normais usam o ticket autenticado
existente obtido pelo servidor do SaaS.

## Primeiro teste completo

1. Use um sistema e repositório de teste, com os dois Apps instalados, rótulos,
   workflow incorporado na branch padrão, ruleset e variáveis/segredos preenchidos.
2. Aplique a migração; faça a publicação normal da Central pela equipe. Abra o
   SaaS como conta comum que já pode relatar bugs, sem vínculo GitHub.
3. Cadastre um bug pequeno e reproduzível de uma área permitida. Ative o botão,
   inclua passos e resultados, sem dados reais de clientes. Envie.
4. Confira o cadastro, a Issue sanitizada e o evento `codex-fix`. Na execução,
   confira gate, Codex, transporte da proposta, verificação e publicação.
5. Confira o PR draft `codex/issue-N`, os rótulos, `Closes #N`, resultados reais,
   CI normal do PR e ausência de deployment. Revise o diff. Não faça merge apenas
   por causa do sucesso automático.
6. Reenvie o mesmo conteúdo com outro ID: deve reutilizar a mesma Issue. Retire a
   sessão/ticket: a chamada paga deve ser rejeitada. Com a opção desligada, não
   deve haver chamada ao GitHub. Force uma regressão no repositório de teste e
   confira que testes falhos impedem a publicação.

Diagnóstico: sem Issue, confira resposta `autoFix`, mapeamento, migração, limites,
chave/App/instalação e rótulos; com Issue sem execução, confira o bot exato,
workflow na branch padrão e políticas Actions; falha no Codex, confira o Secret
OpenAI, modelo, quotas e logs da ação; falha na verificação, confira diff, caminhos,
rede desativada, testes, build e espaço Docker; falha na publicação, confira App,
permissões, branch existente e ruleset. Não imprima chaves nem corpos sensíveis
nos logs para diagnosticar.

## Desativar e acompanhar custos

Desative o workflow na aba Actions e remova o mapeamento de
`BUGFIX_REPOSITORIES` (ou deixe `{}`). Cancele execuções em andamento se necessário.
Relatos normais continuam funcionando e a opção informa indisponibilidade.
Em incidente, suspenda os Apps e revogue as chaves no provedor correspondente.

Monitore consumo do projeto OpenAI, limites/alertas e minutos/armazenamento Actions.
As quotas SQL limitam quantidade de tentativas, não o custo de tokens por tentativa.
Timeout não é teto financeiro; configure limites do projeto/provedor. Contas com
acesso ao sistema podem consumir a quota compartilhada; não há promessa de justiça
por conta. A imagem Docker e os SHAs das ações precisam de atualização revisada.

## Arquivos e validação

- `central-bugs.js`, `dashboard.js`, `cloud.js`: opção no formulário, diagnóstico,
  acompanhamento e reutilização da sessão existente no widget de teste do painel.
- `api/reports.js`, `server.cjs`, `bug-fixes.cjs`: validação, autenticação existente,
  reserva, sanitização, App e resposta sem perder o relato.
- `supabase/migrations/20261015204835_automated_bug_fixes.sql`: tarefas, RLS, quotas e RPC.
- `.github/workflows/codex-bug-fix.yml`: autorização, agente, verificação e publicação.
- `.github/workflows/ci.yml`: CI Node/npm no push/PR, sem credenciais de produção.
- `.github/codex/bug-fix.md`, `proposal.schema.json`, `verify.Dockerfile`,
  `scripts/bugfix-workflow.cjs`, `.dockerignore`: instruções fixas, contrato,
  isolamento, política de patch e publicação.
- `tests/bug-fixes.cjs`, `tests/widget.cjs`, `tests/cloud.cjs`, `tests/sql.cjs`, `tests/build.cjs`,
  `package.json`: testes de regressão e comando `npm run test:bug-fixes`.
- `.env.example`, `README.md`, `vercel.json`, este documento: configuração e operação.

Não foram encontrados arquivos AGENTS.md/CLAUDE.md, configurações dos agentes ou
workflows anteriores no checkout inicial. Nenhum mecanismo de Claude Code foi
substituído. O workflow atua somente no Codex e nunca pede a outro agente para
trabalhar no mesmo bug. A coordenação com um desenvolvedor que esteja corrigindo
manualmente permanece responsabilidade da equipe.

`npm run test:bug-fixes` executa SQL real embarcado, concorrência/deduplicação,
quotas, erros/timeouts, JWT, sanitização, gate, aplicação de patch e publicação de
PR **simulada**, com push somente para um repositório bare temporário local.
Os testes de widget e cloud usam Chromium e APIs locais simuladas. `npm test`,
`npm run test:sql` e `npm run build` cobrem o projeto existente. A imagem Docker e
a integração GitHub/OpenAI reais exigem o primeiro teste acima; não foram
declaradas executadas localmente sem Docker/segredos de ativação.

Resultado local em 15/10/2026: `npm test` (as dez suítes), `npm run test:sql`,
`npm run build`, `actionlint` 1.7.12, validação de sintaxe Node e `git diff --check`
passaram. Falhas de API, Storage, push e timeout nos logs dos testes são injeções
deliberadas dos cenários de recuperação. A interface foi conferida por screenshot
em Chromium mobile; a integração real GitHub/OpenAI e o contêiner não foram executados.

## Referências conferidas

Conferência em 15/10/2026: [Codex Action](https://github.com/openai/codex-action),
[segurança da ação](https://github.com/openai/codex-action/blob/main/docs/security.md),
[orientações oficiais OpenAI](https://developers.openai.com/blog/skills-agents-sdk),
[eventos e tokens GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[App token action](https://github.com/actions/create-github-app-token),
[configuração Git Vercel](https://vercel.com/docs/project-configuration/git-configuration).
As ações estão fixadas em SHAs completos conferidos nas respectivas referências;
Codex Action em `a8d8be6ee028bea4525bc722d16f36687b408c81`, CLI/proxy em `0.162.1`.
O Dockerfile fixa o digest do índice oficial Node.js 22 Bookworm. Revise novas
versões e entradas suportadas antes de atualizar; não troque por `main` flutuante.
