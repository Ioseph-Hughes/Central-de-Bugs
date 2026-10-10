# Central de Bugs — propósito e guia geral

## O que é este plugin?

A Central de Bugs é um canal de feedback que pode ser instalado nos nossos SaaS. Um botão flutuante permite que o usuário relate um problema, sugira uma melhoria ou peça um ajuste enquanto está usando o sistema.

O objetivo é reunir essas informações em uma Central, organizadas por sistema, com descrição, imagens e contexto suficientes para a equipe entender o que aconteceu e acompanhar a solução.

Por exemplo: um valor aparece incompleto no Radar Contratual. O usuário abre o botão, descreve o valor esperado, recorta somente o campo com o erro e envia. A equipe recebe a ocorrência na seção do Radar, abre os detalhes e atualiza seu status até a resolução.

## As duas partes do sistema

| Parte | Para quem | Função |
| --- | --- | --- |
| Plugin de feedback | Usuários dos SaaS | Exibir o botão e permitir enviar relatos com evidências. |
| Painel da Central | Administradores autorizados | Reunir ocorrências por sistema, consultar detalhes e acompanhar os status. |

O plugin é o arquivo `central-bugs.js`, em JavaScript puro. Ele pode ser integrado a um frontend existente, inclusive React, Vue ou Next.js. Seus estilos são isolados para evitar interferência com a aparência do SaaS.

A Central online está em [central-de-bugs.vercel.app](https://central-de-bugs.vercel.app/). A interface e a API são hospedadas na Vercel; o Supabase mantém os registros, os anexos privados e a autenticação dos administradores. O servidor local do repositório serve para testes e mantém seus próprios dados.

## Como o usuário envia um relato

1. Abra **Dar feedback** no SaaS.
2. Escolha **Relatar um bug**, **Sugerir uma melhoria** ou **Pedir um ajuste**.
3. Escreva um título e explique o que aconteceu. Para um bug, inclua o resultado esperado e como repetir o problema.
4. Acrescente links, um por linha, se ajudarem a identificar a página ou situação.
5. Anexe imagens, cole prints no formulário ou use uma das opções de captura abaixo.
6. Revise e clique em **Enviar relato**. Aguarde a confirmação do recebimento.

É possível anexar várias imagens e escrever textos longos. O formulário não impõe limite de caracteres ou quantidade de anexos; os limites do navegador e do serviço de armazenamento continuam valendo. Os limites da versão online estão em [DEPLOY.md](DEPLOY.md).

Fechar o formulário ou cancelar uma captura mantém o rascunho e os anexos enquanto a página continua aberta. Uma falha no envio também mantém essas informações para tentar novamente. Recarregar ou sair da página descarta o rascunho; após um envio confirmado, o formulário é limpo.

## Capturar somente o erro ou a tela inteira

As opções **Selecionar área** e **Tela inteira** ficam lado a lado no formulário.

### Selecionar área

1. Clique em **Selecionar área**.
2. No seletor do navegador, escolha a tela, janela ou aba onde o erro aparece e autorize a captura.
3. Na prévia, arraste do início ao fim da região desejada. Você pode desenhar outra seleção para refazer o recorte.
4. Confira o retângulo e clique em **Anexar recorte**.

Somente os pixels dentro da seleção viram o arquivo PNG anexado. A imagem completa permanece temporariamente no navegador para permitir o recorte e não é enviada como anexo desse modo. O compartilhamento da tela termina assim que a imagem é capturada, antes de você escolher a região.

Para fazer a seleção por teclado, abra **Ajustar recorte por medidas** e informe a distância da esquerda, a distância do topo, a largura e a altura, em pixels da imagem original. Use Tab para navegar entre os campos e os botões. **Cancelar** ou Esc retorna ao relato sem adicionar uma imagem.

### Tela inteira

Clique em **Tela inteira**, escolha a fonte no seletor do navegador e autorize. O plugin anexa uma imagem completa da fonte escolhida, sem recorte. Se você escolher uma aba ou janela, a captura completa corresponde àquela aba ou janela; para incluir o monitor inteiro, escolha a tela no seletor.

O formulário de feedback fica escondido durante a captura. Nada é enviado à Central até você clicar em **Enviar relato**.

A captura depende de suporte do navegador, HTTPS ou localhost e autorização a cada uso. Em navegadores sem esse recurso, use **Adicionar imagens** ou cole um print feito pelo sistema operacional. Essa exigência vem da [API de captura do navegador](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).

## Mover e recolher o botão

- Arraste o botão pela alça ou pelo texto para colocá-lo onde preferir.
- Solte perto de uma borda para recolhê-lo: ficará somente uma seta.
- Arraste a seta pela borda ou até outro canto para mudar sua posição.
- Clique na seta para expandir o botão novamente.
- O menu **Posição e visibilidade do botão** também permite escolher um canto e recolher o botão por teclado.

A posição e o estado recolhido ficam salvos naquele navegador, separadamente para cada sistema.

## O que chega à Central

Cada ocorrência identifica o sistema e o tipo de relato. Nos detalhes, a equipe encontra:

- Título e descrição completos.
- Imagens anexadas e links enviados pelo usuário.
- Data e hora do relato.
- URL e título da página de origem, idioma e dimensões da janela.
- Dados de identificação do usuário, quando o SaaS os fornece na integração.

O plugin não coleta automaticamente senhas, cookies, logs ou o conteúdo completo da página. A captura contém a região ou fonte que o usuário escolheu; ele deve revisar a imagem antes de enviar. A URL de origem inclui seus parâmetros, por isso a equipe que integra o plugin deve verificar o que o SaaS coloca nessa URL.

No painel, os relatos são separados por sistema e podem ser pesquisados e filtrados. Os status disponíveis são **Novo**, **Em análise**, **Em correção** e **Resolvido**. O botão **Resolver** marca a ocorrência individual como resolvida; os detalhes permitem revisar o status. O painel também oferece modo claro e escuro.

A ferramenta organiza o atendimento. A investigação, implementação da correção e comunicação com o cliente continuam sendo responsabilidade da equipe.

## Como instalar em outro SaaS

O responsável pela integração cadastra um identificador para o sistema e suas origens permitidas na Central. Depois, adiciona o script ao frontend com o identificador e o endereço da API. Exemplo:

```html
<script defer
  src="https://central-de-bugs.vercel.app/central-bugs.js"
  data-project-id="identificador-do-saas"
  data-endpoint="https://central-de-bugs.vercel.app/api/reports"
  data-transport="signed-upload"
></script>
```

Substitua `identificador-do-saas` pelo identificador cadastrado. O exemplo só enviará relatos depois desse cadastro e da autorização do domínio. A política de segurança do SaaS também precisa permitir carregar o script e acessar a API e os uploads do Supabase, caso o site use CSP.

É possível hospedar uma cópia do arquivo no próprio SaaS. Nesse caso, atualize essa cópia quando quiser receber novas funcionalidades. Ao usar o endereço hospedado acima, o SaaS recebe a versão publicada pela Central.

O guia técnico de integração, os métodos disponíveis e o contrato de envio estão em [README.md](README.md). O passo a passo de hospedagem, banco, cadastro de sistemas e administradores está em [DEPLOY.md](DEPLOY.md).

## Como compartilhar e acessar

Depois que o plugin está instalado e o domínio autorizado, o usuário utiliza o botão no próprio SaaS, em qualquer máquina com navegador compatível e acesso à internet. Ele não precisa baixar o repositório nem conhecer a senha da Central para enviar um relato. O SaaS pode exigir seu próprio login.

Quem precisa consultar e gerenciar as ocorrências acessa o painel online com uma conta de administrador autorizada. Para dar esse acesso a outra pessoa da equipe, crie uma conta própria e cadastre-a como administradora conforme [DEPLOY.md](DEPLOY.md).

Para entregar a integração a outro desenvolvedor ou IA, compartilhe este guia, o `README.md`, o `central-bugs.js`, o identificador do sistema e o endereço da API. Se for compartilhar o repositório privado, conceda acesso pelo GitHub. As credenciais administrativas e a chave secreta do servidor ficam fora do código distribuído.
