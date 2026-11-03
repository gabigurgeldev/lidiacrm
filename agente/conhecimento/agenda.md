# Agenda, Tipos de agendamento e Profissionais

Rotas: /app/agenda, /app/settings/tenant/agenda, /app/settings/tenant/agenda/profissionais

## O que é
A **Agenda** mostra o que está marcado, com quem e quem atende — o seu e o da equipe. Para ela ter horários para oferecer, duas coisas precisam estar configuradas: os **Tipos de agendamento** (o que se pode marcar, quanto dura e quem atende) e as **Profissionais da agenda** (quem atende, em que horários, folgas e serviços). É isso que a tela de marcar e o agente de IA oferecem ao cliente.

## Onde fica
- **Atendimento › Agenda** — todos veem. Quem é atendente vê a própria agenda ("Minha agenda"); a gerência vê a agenda da equipe inteira.
- **Configurações › Tipos de agendamento** (seção "Sua empresa") — fica dentro do hub **Configurações**, no rodapé do menu lateral. Todos veem; só gerente ou administrador cria e edita.
- **Configurações › Profissionais da agenda** (seção "Sua empresa") — todos veem; só gerente ou administrador cria e edita.
- Horários de atendimento de quem tem login: **Configurações › Equipe**, aba **Atendimento** (só gerente ou administrador edita).

Na Agenda há as visões **Dia**, **Semana**, **Mês** e **Profissionais**, e um histórico com **Próximos**, **Aguardando confirmação**, **Passados** e **Cancelados**.

## Passo a passo
### Primeira configuração (para a agenda começar a oferecer horários)
1. Abra **Configurações › Tipos de agendamento** e clique em **Novo tipo de agendamento**. Preencha nome, categoria (Consulta, Visita, Reunião etc.), **Duração (minutos)** e **Onde acontece**, e clique em **Criar tipo**.
2. Abra **Configurações › Profissionais da agenda** e clique em **Nova profissional**. Dê o nome e a **Cor na agenda**. Em **Login no sistema**, vincule a um membro da equipe ou escolha **Sem login — só agenda** (ela não ocupa vaga de usuário).
3. Ainda na profissional, preencha a **Jornada** (dias e horários) e clique em **Salvar jornada**. Em **Serviços**, marque os tipos que ela faz e clique em **Salvar serviços**.
4. Para quem tem login, a jornada é a mesma de **Equipe › Atendimento**: lá, use **Editar horário** ao lado do nome e **Adicionar janela** para cada período.

### Marcar um horário pela Agenda
1. Abra **Atendimento › Agenda** e clique em **Novo agendamento** (ou clique num horário livre da grade).
2. Escolha o **Tipo de agendamento**, busque o cliente por nome ou telefone e escolha **Quem atende** (ou **Qualquer habilitada**).
3. Escolha o dia e um dos horários livres. Se quiser, preencha **Observações**.
4. Confirme. Aparece "Marcado." e você pode **Ver na agenda** ou **Marcar outro**.

### Marcar um horário direto da conversa
1. No **Inbox**, abra a conversa do cliente.
2. Em **Mais ações**, clique em **Marcar horário na agenda…**.
3. Escolha o **Tipo de agendamento** e um horário livre. O agendamento já fica ligado àquele cliente.

### Remarcar, confirmar ou cancelar
1. Clique no agendamento na grade para abrir o detalhe.
2. Use **Confirmar**, **Realizado** ou **Faltou** para registrar o desfecho.
3. Para mudar o horário, clique em **Remarcar** (ou arraste o bloco na grade, quando permitido).
4. Para cancelar, clique em **Cancelar agendamento** e informe o motivo.
5. Do detalhe também dá para **Abrir conversa** ou **Abrir negócio** do cliente.

### Ligar o lembrete automático no WhatsApp
1. Em **Configurações › Tipos de agendamento**, abra o tipo e clique em **Editar**.
2. Em **Lembrete no WhatsApp**, ligue **Enviar lembrete ao cliente** e escolha a **Antecedência do lembrete** (de 1 hora a 2 dias antes).
3. Salve. O lembrete sai sozinho antes do horário.

### Lançar folga ou horário extra
1. Em **Configurações › Profissionais da agenda**, abra a profissional e vá em **Folgas**.
2. Em **O que é**, escolha **Folga — não atende** ou **Horário extra — atende além da jornada**, defina início e fim (ou **O dia todo**) e um motivo opcional.
3. Clique em **Lançar**.

### Conectar a agenda do Google
1. Na **Agenda**, clique em **Conectar Google** e autorize na tela do Google, mantendo as permissões marcadas.
2. Os compromissos que já estão no Google aparecem como ocupados, e o que você marcar aqui vai para lá.

## Dúvidas comuns
- **Aparece "Você ainda não publicou seus horários de atendimento". O que faço?** Falta a jornada. Clique em **Configurar meus horários de atendimento** ou peça a um gerente para abrir **Configurações › Equipe › Atendimento** e usar **Editar horário** ao lado do seu nome.
- **Por que não aparece nenhum horário livre?** Confira: existe um tipo de agendamento ativo? A profissional tem jornada salva? O tipo está marcado nos **Serviços** dela? Sem isso, não há horário para oferecer.
- **Como marco um horário?** Pela **Agenda › Novo agendamento** ou, na conversa do Inbox, em **Mais ações › Marcar horário na agenda…**.
- **A profissional precisa ter login?** Não. Escolha **Sem login — só agenda**: ela tem agenda, cor e serviços, e a recepção marca por ela.
- **Um serviço precisa de duas pessoas.** No tipo de agendamento, em **Pessoas por atendimento**, escolha **Duas — principal e apoio**. Só aparecem horários em que as duas estão livres.
- **Por que o lembrete não foi enviado?** O detalhe do agendamento explica: pode ter sido marcado em cima da hora, o cliente não tem conversa, pediu para não receber mensagens, ou o canal oficial exige modelo aprovado fora da janela de 24 horas.
- **Como desativo um tipo que não uso mais?** Em **Tipos de agendamento**, use **Desativar**. Dá para **Reativar** depois.
- **A sincronização com o Google não está disponível.** A instalação ainda não tem a conexão com o Google configurada. A agenda funciona normalmente, só não sincroniza; fale com quem administra o sistema.
