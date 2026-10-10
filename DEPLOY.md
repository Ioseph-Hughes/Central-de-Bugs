# Publicar a Central com Supabase e Vercel

O código já tem login, API da Vercel, armazenamento privado de imagens e botão Resolver. A instalação abaixo ativa esses recursos na sua conta. Os dados da Central local não são migrados automaticamente.

## 1. Instalar o banco e o armazenamento

Abra seu projeto no [Supabase](https://supabase.com/dashboard), entre em **SQL Editor → New query**, copie o conteúdo de [supabase/setup.sql](supabase/setup.sql) e clique em **Run**. A execução cria as tabelas da Central, as permissões e o bucket privado `central-attachments`. Pode executar novamente sem apagar ocorrências.

## 2. Criar seu acesso ao painel

Em **Authentication → Users → Add user → Create new user**, crie seu usuário com e-mail e senha. Marque a confirmação do e-mail para entrar imediatamente, se essa opção aparecer. Não é necessário habilitar login anônimo ou cadastro público para o plugin.

Volte ao **SQL Editor** e execute o código abaixo, substituindo `SEU_EMAIL` pelo e-mail criado:

```sql
do $$
declare admin_id uuid;
begin
  select id into admin_id from auth.users where email = 'SEU_EMAIL';
  if admin_id is null then raise exception 'Crie primeiro o usuário em Authentication > Users'; end if;
  insert into public.central_admins(user_id) values(admin_id)
  on conflict(user_id) do nothing;
end $$;
```

Somente os usuários adicionados a `central_admins` podem consultar os relatos, abrir imagens e alterar status. O login é feito com e-mail e senha na Central. O botão do SaaS continua funcionando sem exigir um login adicional de quem envia feedback.

## 3. Configurar quatro variáveis na Vercel

Abra o projeto da Central em **Settings → Environment Variables**. Cadastre para **Production**:

| Nome | Valor |
| --- | --- |
| `SUPABASE_URL` | `https://wpvhwnipsejexnmdqceq.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_O4OvZodRc28S3p8ObjG3Pg_26qgJb4K` |
| `SUPABASE_SECRET_KEY` | Sua chave **Secret** em **Supabase → Settings → API Keys** |
| `CENTRAL_ORIGIN` | O endereço real da Central, por exemplo `https://central-de-bugs.vercel.app`, **sem barra final** |

A chave publicável informada já foi conferida com a API do projeto. A chave secreta deve ser copiada **diretamente para a Vercel**: não coloque no código, no HTML, no GitHub ou na conversa. Ela é usada exclusivamente pela função da API e não entra no build do navegador. Não use prefixo `VITE_` ou `NEXT_PUBLIC_` para ela.

Se usar Preview deployments, configure as variáveis nesse ambiente também. `CENTRAL_ORIGIN` precisa corresponder ao domínio em que você abre o painel; prefira o domínio estável de Production.

## 4. Fazer um novo deployment

Em **Settings → Build and Deployment**, confira:

- **Framework Preset:** Other.
- **Build Command:** `npm run build`.
- **Output Directory:** `dist`.
- **Root Directory:** raiz do repositório.

Publique a versão atualizada de `main`. Alterações de variáveis exigem um novo deployment. O projeto fixa Node.js 22. O arquivo `vercel.json` configura a função `/api/reports`; não configure `server.cjs` como função ou comando de inicialização na Vercel.

Abra o domínio principal. Deve aparecer **Entre na sua Central**. Entre com o usuário do passo 2 e teste **Testar o widget**, anexando duas imagens. Envie, atualize o painel, abra os detalhes e clique em **Resolver**.

## 5. Instalar no Radar Contratual

Adicione antes de `</body>`, ou por meio do componente Script do seu frontend. Substitua `SUA-CENTRAL.vercel.app` pelo domínio real:

```html
<script defer
  src="https://SUA-CENTRAL.vercel.app/central-bugs.js"
  data-project-id="radar-contratual"
  data-endpoint="https://SUA-CENTRAL.vercel.app/api/reports"
  data-transport="signed-upload"
></script>
```

O SQL já autoriza `https://radarcontratual.com` e `https://www.radarcontratual.com`. Para testar outro domínio, subdomínio ou localhost, acrescente a **origem exata**, incluindo protocolo e porta, no Supabase:

```sql
update public.central_projects
set origins = array[
  'https://radarcontratual.com',
  'https://www.radarcontratual.com',
  'http://localhost:4180'
]
where id = 'radar-contratual';
```

Para conectar outro SaaS:

```sql
insert into public.central_projects(id,name,origins)
values('portal-cliente','Portal do Cliente',array['https://portal.seu-dominio.com']);
```

Use esse mesmo `id` na tag do plugin. O nome aparecerá automaticamente no painel. `projectId` identifica o sistema, sem ser uma credencial; CORS limita o uso no navegador e a API também aplica quotas persistentes.

## Como o envio e os limites funcionam

O widget primeiro reserva a ocorrência, envia as imagens diretamente para URLs assinadas do Supabase e pede a confirmação final. A Central verifica tamanho, MIME e assinatura dos arquivos antes de tornar a ocorrência visível. Falhas mantêm o rascunho no navegador; a nova tentativa reutiliza os arquivos recebidos e o identificador, sem duplicar a ocorrência. Editar um relato após uma falha cria uma nova reserva, preservando a consistência dos arquivos.

Imagens são privadas. O painel gera links com duração de uma hora ao abrir os detalhes; reabra os detalhes quando um link expirar. O formulário oferece **Selecionar área** (prévia com recorte) e **Tela inteira**. A captura nativa requer HTTPS ou localhost e autorização do navegador. O propósito e o uso geral do plugin estão em [GUIA-DO-PLUGIN.md](GUIA-DO-PLUGIN.md).

O widget não limita o texto ou a quantidade de fotos na interface. A API aceita até **1 MB de texto e metadados por relato**; o bucket aceita até **50 MB por imagem**, sujeito aos limites do plano Supabase. As fotos não passam pela função da Vercel, que possui limite de corpo de requisição. A API permite 20 novas reservas por origem de rede/sistema em 10 minutos e 500 por sistema/dia; esses valores estão em `central_reserve` no SQL. Tentativas da mesma reserva não consomem novas ocorrências.

A lista traz resumos e até 1.000 ocorrências recentes, respeitando um orçamento de resposta de 2 MB; o painel sinaliza se o histórico for parcial. Os detalhes sempre buscam o texto completo e a pesquisa consulta a descrição inteira no banco. A atualização online ocorre a cada 15 segundos com a aba visível. Para consultar um histórico maior de uma vez, será necessário adicionar paginação; os registros antigos continuam salvos no banco.

Reservas interrompidas ficam com `ready=false` e não aparecem no painel. Para limpar reservas antigas, faça backup, consulte essas linhas e remova primeiro os arquivos de suas pastas no bucket pela interface/API de Storage, depois as linhas. Não remova registros de `storage.objects` diretamente por SQL. Não há limpeza automática agendada nesta versão.

## Se algo falhar

| Mensagem | Verificar |
| --- | --- |
| Prévia / armazenamento pendente | As duas variáveis públicas e o novo deployment. |
| Configure as variáveis / instalação incompleta | Chave secreta, `CENTRAL_ORIGIN`, SQL do passo 1 e logs de `/api/reports`. |
| Usuário não autorizado | E-mail criado e inserção em `central_admins`. |
| Domínio ou sistema não autorizado | `data-project-id`, domínio/protocolo/porta em `central_projects.origins` e `CENTRAL_ORIGIN`. |
| Imagem inválida ou acima do limite | Formato real do arquivo e tamanho; substitua ou remova a imagem indicada. |
| 500 FUNCTION_INVOCATION_FAILED | Abra os logs da função no deployment atual; o código sozinho não informa a causa. |

Referências: [chaves do Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [armazenamento privado](https://supabase.com/docs/guides/storage/security/access-control), [URLs de upload assinadas](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl), [limites das funções Vercel](https://vercel.com/docs/functions/limitations) e [variáveis Vercel](https://vercel.com/docs/environment-variables/managing-environment-variables).
