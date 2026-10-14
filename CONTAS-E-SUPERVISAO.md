# Contas da Central e supervisão de sistemas

Cada usuário autorizado entra na mesma Central com sua própria conta. As contas deste painel são independentes das contas dos SaaS que podem usar o widget.

## Papéis

- **Conta principal:** acompanha e administra todos os sistemas, incluindo os de outros usuários. Pode selecionar contas da Central para supervisionar cada sistema no cadastro ou na edição.
- **Dono do sistema:** é automaticamente o usuário que cadastrou o sistema. Pode administrar sua integração, acompanhar relatos, alterar status, apagar ocorrências e desconectar ou excluir seus próprios sistemas. Não pode transferir a propriedade nem conceder supervisão pela API.
- **Supervisor:** vê somente os sistemas compartilhados com ele, além dos seus próprios. Pode ler os relatos, abrir imagens e mudar status. Não pode apagar bugs, alterar a integração, renovar o ID, desconectar ou excluir um sistema compartilhado.

Ser supervisor de um sistema não dá acesso aos outros sistemas do dono. A conta principal mantém o acesso global. Retirar a supervisão bloqueia a próxima consulta, atualização ou notificação daquele sistema. Links de imagens já emitidos continuam válidos até sua expiração (até uma hora).

## Compartilhar um sistema

1. Entre na conta principal.
2. Abra **Central de Sistemas → Cadastrar sistema**, ou **Editar** em um sistema existente.
3. Preencha a empresa, nome, disponibilidade do widget e domínios.
4. Em **Compartilhar supervisão**, marque as contas desejadas.
5. Salve. Os supervisores verão esse sistema ao atualizar o painel ou entrar novamente. Para retirar o acesso, desmarque a conta e salve.

O ID de integração continua no servidor do SaaS. Compartilhar supervisão não muda o ID, os domínios, as contas que podem usar o widget ou os relatos antigos.

## Instalação e novas contas

Em uma instalação existente na versão 0.10, aplique `supabase/migrations/20261014011509_account_ownership_supervision.sql` antes de publicar a versão 0.11. Ela atribui os sistemas anteriores à conta principal já existente, preservando seus IDs, disponibilidade e relatos; não cria usuários no Auth nem altera senhas. Essa instalação deve ter a estrutura de notificações da versão 0.8 aplicada.

Em instalações novas, execute `supabase/setup.sql` e a migração de notificações. Crie usuários usando o Supabase Auth ou sua API administrativa no servidor; nunca insira senhas diretamente no SQL, no Git ou em arquivos públicos. Autorize cada conta com:

```sql
insert into public.central_admins(user_id)
select id from auth.users where lower(email)=lower('EMAIL_DA_CONTA')
on conflict(user_id) do nothing;
```

Escolha uma única conta principal e atribua os cadastros anteriores a ela antes de habilitar outras contas:

```sql
update public.central_admins a set is_primary=true
from auth.users u where u.id=a.user_id and lower(u.email)=lower('EMAIL_PRINCIPAL');
update public.central_projects set owner_id=(select user_id from public.central_admins where is_primary)
where owner_id is null;
```

A migração desta instalação identifica a conta principal solicitada pelo proprietário pelo e-mail confirmado no Auth. Em outra instalação, adapte esse e-mail antes de aplicar a migração. O índice permite somente uma conta principal.

## Proteção dos dados

As tabelas e funções continuam privadas, sem acesso direto dos navegadores. O servidor valida o usuário com `getUser`, confere sua autorização em `central_admins` e filtra relatórios, busca, estatísticas, sistemas, detalhes, imagens e notificações por propriedade/supervisão. A lista e a busca são filtradas antes do limite de resultados. Os papéis vêm do banco, nunca de `user_metadata` editável. O dono é definido pelo servidor; valores de propriedade enviados pelo navegador são ignorados.

A separação por conta é uma função do painel online. A Central local continua sendo um ambiente de desenvolvimento sem login. Os testes usam duas identidades isoladas e PostgreSQL embarcado; nenhuma senha real é incluída no código ou nas fixtures.
