# Teste de integração no Radar Contratual

O domínio público https://www.radarcontratual.com foi visitado: a landing e o
login carregam, mas ainda não incluem o widget. O teste da integração usa uma
cópia isolada do frontend Next.js, baseada no commit
`219dab3` de `MVPcontratos/MVPREPOSITORIO`. O site publicado, as alterações do
checkout principal, o banco e a autenticação permanecem preservados.

## Instalação preparada

Copie o `central-bugs.js` deste repositório para `public/central-bugs.js` no Radar.
Em `app/layout.tsx`, depois de `{children}`, adicione:

```tsx
<Script
  id="central-bugs-widget"
  src="/central-bugs.js"
  strategy="afterInteractive"
  data-project-id="radar-contratual"
  data-endpoint={process.env.NEXT_PUBLIC_CENTRAL_BUGS_ENDPOINT}
/>
```

Esse layout já importa `Script` de `next/script`. A integração acompanha a
navegação do App Router e mantém uma única instância do widget.

O diff de instalação está em [radar-contratual.patch](radar-contratual.patch).
Ele modifica somente o layout; o arquivo do widget é copiado separadamente.

## Resultado verificado em 09/10/2026

- Formulário funcionando sobre a landing do Radar, com os estilos isolados.
- Relato fictício recebido via HTTP: texto, dois links e duas imagens binárias,
  conferindo o projeto, a página de origem e o tamanho de cada arquivo.
- Arraste até a borda recolhe; a seta continua móvel e o clique expande.
- Estado e posição preservados ao recarregar; seta inteira dentro da área
  visível, inclusive com a barra de rolagem do site.
- Navegação da landing ao login mantém uma única instância, com o formulário
  de login presente.
- `pnpm check:full` passou no Radar: documentação, inventário, TypeScript,
  regressões existentes e build. Após o ajuste de posicionamento do widget,
  foram repetidos seu teste de navegador e `pnpm check:quick` do Radar.

As páginas autenticadas e a autorização real de captura de tela ainda precisam
de verificação com uma conta/navegador de teste. A captura do widget foi
verificada com frames simulados nos seus testes automatizados.

## Reproduzir o teste local

No projeto Central de Bugs, com Node.js 20 ou superior:

```sh
npm start
```

No `.env.local` da cópia de teste do Radar, mantenha somente as configurações
públicas necessárias ao frontend e acrescente:

```env
NEXT_PUBLIC_CENTRAL_BUGS_ENDPOINT=http://127.0.0.1:4181/reports
```

Inicie o Radar em `localhost:4180`, usando o pnpm 10.11.0 declarado no projeto.
A Central aceita as origens locais `localhost:4180` e `127.0.0.1:4180`, além do próprio painel em 4173. Abra http://localhost:4173 para ver a seção **Radar Contratual**. Os relatos aparecem automaticamente, com detalhes e imagens; são salvos em `data/` e continuam disponíveis após recarga e reinício.

`http://127.0.0.1:4181/api/reports` permite conferir os registros recebidos. O endpoint `/latest` do receptor antigo foi substituído pela lista completa. Nenhum relato deste teste é enviado a um serviço externo.

Para verificar o receptor e o painel automaticamente, execute `npm run test:receiver`. Ele usa armazenamento temporário e encerra suas próprias portas. Não inicia o ambiente de testes do usuário.

## Antes da publicação

- Definir o receptor definitivo e substituir a configuração local pelo endereço
  real. O receptor deste repositório é uma Central local de testes, com armazenamento em disco e sem autenticação de produção.
- Validar páginas autenticadas com uma conta de teste.
- Executar os checks do Radar e seguir suas regras de aprovação para produção.

Sem endpoint configurado, o widget mantém o rascunho e informa que o envio está
pendente de configuração.

## Painel conectado · v0.3

O painel inicial era uma demonstração separada do receptor do Radar. Na v0.3, os dois usam o mesmo armazenamento. A interface organiza sistemas e ocorrências, permite acompanhar o status e oferece modo escuro. O receptor antigo mantinha apenas o último relato em memória e descartava os binários; não existe recuperação retroativa do histórico anterior.
