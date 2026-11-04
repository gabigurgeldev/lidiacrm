# Atendimento: Inbox, Radar, Respostas rápidas e Disparo em massa

Rotas: /app/inbox, /app/radar, /app/templates, /app/disparos

## O que é
O grupo **Atendimento** é onde a equipe passa o dia. O **Inbox** reúne as conversas de WhatsApp, com você e o atendimento automático (IA) trabalhando lado a lado. O **Radar** mostra quem esfriou e ainda está em aberto. As **Respostas rápidas** guardam textos prontos para responder mais rápido, e o **Disparo em massa** manda a mesma mensagem para uma lista de contatos, no ritmo que o número aguenta.

## Onde fica
- **Atendimento › Inbox** — todos veem.
- **Atendimento › Radar** — todos veem.
- **Atendimento › Respostas rápidas** — todos veem.
- **Atendimento › Disparo em massa** — só gerente ou administrador.

No Inbox, a lista de conversas tem as abas **Fila**, **Minhas**, **Todas**, **Fechadas** e **IA**.

## Passo a passo
### Responder uma conversa
1. Abra **Atendimento › Inbox** e clique numa conversa da lista à esquerda.
2. Se ela ainda não tem responsável, clique em **Assumir** no topo da conversa. Ao assumir, o atendimento automático para nessa conversa.
3. Escreva no campo **Digite uma mensagem** e aperte **Enter** para enviar (**Shift + Enter** quebra a linha). No celular, **Enter** quebra a linha e quem envia é o botão de enviar.
4. Para anexar foto, vídeo, documento, áudio, contato ou uma enquete, use o botão de opções ao lado do campo de texto. Para gravar áudio, use **Gravar áudio**.

### Usar uma resposta rápida no atendimento
1. No campo de mensagem, digite **/** (barra). Aparece a lista de respostas salvas.
2. Continue digitando para filtrar e escolha a resposta. Ela entra no campo para você revisar antes de enviar.
3. Também dá para abrir pelo menu de opções do campo de texto, em **Mensagens prontas**.

### Criar uma resposta rápida
1. Abra **Atendimento › Respostas rápidas** e clique em **Novo template**.
2. Preencha **Título**, **Mensagem** e, se quiser, um **Atalho (opcional)**. Use `{{primeiro_nome}}` para o cliente receber o próprio nome.
3. Marque **Compartilhar com a equipe** se todos devem poder usar (sem marcar, ela é só sua). Compartilhar é permitido a gerente ou administrador.
4. Clique em **Criar template**.

### Escrever uma nota interna (só a equipe vê)
1. No menu de opções do campo de texto, escolha **Nota interna**.
2. Escreva e aperte **Enter**. A nota aparece na conversa marcada como "só o time vê" e não é enviada ao cliente.
3. Para voltar a escrever ao cliente, clique em **Voltar a responder**.

### Transferir, liberar ou fechar uma conversa
1. Com a conversa aberta, clique em **Mais ações** (os três pontos no topo).
2. Escolha **Transferir** para passar a outro atendente (o motivo é opcional), **Liberar** para devolvê-la à Fila, ou **Devolver ao automático** para a IA voltar a atender.
3. Para encerrar, clique em **Fechar**. Conversas fechadas ficam na aba **Fechadas**, de onde podem ser reabertas (**Reabrir na Fila**, **Reabrir em Minhas** ou **Reabrir com o automático**).

### Marcar horário, agendar mensagem ou ativar um fluxo pela conversa
No menu **Mais ações** da conversa:
- **Marcar horário na agenda…** — escolha o tipo de agendamento e um horário livre.
- **Agendar mensagem…** — escolha data e hora; a mensagem sai sozinha. Dá para pedir um aviso no seu WhatsApp também.
- **Lembrar** (Em 1 hora, Em 3 horas, Em 24 horas) — cria um lembrete para você.
- **Ativar fluxo** — dispara para este contato um fluxo de ativação manual.

### Ver e editar os dados do cliente pela conversa
1. Clique em **Dados do contato** no topo da conversa.
2. O painel mostra o Kanban em que o contato está (**Contato no Kanban**), as tags, a data de nascimento, as demandas abertas, os próximos horários marcados e o histórico.
3. Para mudar o contato de coluna, escolha a nova coluna ali mesmo. Se ele não está em nenhum Kanban, use **Colocar em um Kanban**.
4. Para exportar a conversa, use **Exportar conversa** (PDF ou Excel).

### Atender pelo celular
1. No celular, o Inbox funciona como o WhatsApp: a lista de conversas ocupa a tela inteira e, ao tocar numa conversa, ela abre em tela cheia.
2. Para voltar à lista, toque na seta **Voltar para as conversas** no canto do topo, ou use o voltar do próprio aparelho.
3. Os dados do cliente ficam em **Mais ações** (os três pontos no topo da conversa) › **Dados do contato**.
4. Na parte de baixo da tela fica a barra com **Conversas**, **Kanban**, **Contatos** e **Agenda**. As outras telas do sistema estão em **Mais**, no fim dessa barra. A barra some enquanto uma conversa está aberta ou o teclado está na tela.

### Usar o Radar
1. Abra **Atendimento › Radar** (título "Radar de risco").
2. A lista mostra demandas abertas que esfriaram, separadas em **Crítico**, **Em risco** e **Em voo** (em voo = o assistente já agendou um retorno).
3. Clique numa demanda para abrir a conversa, ou em **Assumir** para trazê-la para você direto do Radar.
4. Na conversa, abra **Dados do contato** e use **Marcar próximo passo** para registrar o que acontece a seguir — assim a demanda deixa de aparecer como risco.

### Fazer um disparo em massa
1. Abra **Atendimento › Disparo em massa** e clique em **Novo disparo**. São 4 passos.
2. Dê um **Nome do disparo** (só você vê) e envie a **Planilha de contatos (.csv)**, com uma coluna de telefone. No Excel, use "Salvar como" → "CSV UTF-8".
3. Escolha **Por qual número enviar**, escreva a mensagem (pode ter imagem ou vídeo) e use `{{primeiro_nome}}` para personalizar. Números da API oficial só enviam **Modelo aprovado**.
4. Ajuste o **Tempo entre uma mensagem e outra** e, se quiser, **Começar quando**.
5. Clique em **Criar disparo para N pessoas**. O disparo é criado parado: abra-o, confira e clique em **Disparar para N pessoas**.
6. Na tela do disparo você acompanha pessoa a pessoa o que saiu, e pode **Tentar de novo** os que falharam.

## Dúvidas comuns
- **Por que não vejo todas as conversas?** Depende da configuração em **Configurações › Distribuição de atendimento**. Se ela estiver em "Os seus, mais os que ainda não têm dono", o atendente vê só as conversas dele e a Fila; em "Só os seus", vê apenas as que foram direcionadas a ele. Nesses casos a aba **Todas** some para quem tem papel de Atendente. Gerente e administrador sempre veem tudo.
- **Consigo assumir ou transferir para mim a conversa de uma colega?** Quando a distribuição esconde as conversas das colegas ("Os seus, mais os que ainda não têm dono" ou "Só os seus"), não: o atendente só assume ou transfere as conversas que ele consegue ver. Para passar uma conversa de uma atendente para outra, a dona dela usa **Transferir**, ou um gerente ou administrador faz a troca.
- **Qual a diferença entre Fila, Minhas e Todas?** **Fila** são conversas sem responsável (as que esperam há mais tempo aparecem primeiro). **Minhas** são as que você assumiu. **Todas** mostra tudo o que você pode ver. **IA** mostra as que o atendimento automático está conduzindo.
- **Por que só consigo mandar "modelo aprovado"?** Em números da API oficial do WhatsApp, passadas 24 horas da última mensagem do cliente, a plataforma só aceita modelos aprovados. Escolha um modelo em **Enviar modelo**; quando o cliente responder, a janela reabre.
- **A IA está respondendo por cima de mim. Como paro?** Clique em **Assumir** ou, em **Mais ações**, em **Pausar o automático**. Para devolver, use **Devolver ao automático**.
- **O que é "Contato bloqueado"?** O cliente pediu para não receber mensagens. O envio fica desabilitado para respeitar o pedido.
- **Tem atalhos de teclado?** Sim: **j** e **k** passam de conversa, **r** foca a resposta, **a** assume, **e** fecha e **?** mostra a lista de atalhos.
- **Posso assinar minhas mensagens com meu nome?** Sim, pelo controle **Assinatura das mensagens** junto do campo de texto: ligue **Assinar minhas mensagens** e defina o nome.
- **Por que o disparo é lento?** O intervalo entre mensagens protege o número contra bloqueio do WhatsApp. Números novos passam por aquecimento e enviam pouco por dia no início.
- **Quem pode fazer disparo em massa?** Só gerente ou administrador.
