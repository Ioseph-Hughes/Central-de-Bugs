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
npm run test:receiver
```

No `.env.local` da cópia de teste do Radar, mantenha somente as configurações
públicas necessárias ao frontend e acrescente:

```env
NEXT_PUBLIC_CENTRAL_BUGS_ENDPOINT=http://127.0.0.1:4181/reports
```

Inicie o Radar em `localhost:4180`, usando o pnpm 10.11.0 declarado no projeto.
O receptor aceita somente as origens locais `localhost:4180` e
`127.0.0.1:4180`. Os relatos ficam em memória; encerrá-lo apaga os dados.
`http://127.0.0.1:4181/latest` permite conferir o último relato e os metadados
dos arquivos recebidos. Nenhum relato deste teste é enviado a um serviço externo.
Para verificar o receptor automaticamente, execute
`node tests/mock-receiver.cjs --check`; ele abre e encerra uma porta temporária.

## Antes da publicação

- Definir o receptor definitivo e substituir a configuração local pelo endereço
  real. O receptor deste repositório é apenas um instrumento de teste.
- Validar páginas autenticadas com uma conta de teste.
- Executar os checks do Radar e seguir suas regras de aprovação para produção.

Sem endpoint configurado, o widget mantém o rascunho e informa que o envio está
pendente de configuração.
