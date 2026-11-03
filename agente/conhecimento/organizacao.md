# Organização: Configurações, Equipe e dados da empresa

Rotas: /app/settings, /app/team, /app/settings/atendimento, /app/settings/aniversario, /app/settings/tenant, /app/settings/marca, /app/settings/billing, /app/lgpd/requests, /app/settings/api-tokens

## O que é
O grupo **Organização** reúne tudo que se ajusta de vez em quando: quem trabalha na empresa e com qual papel, como os clientes novos são distribuídos, a mensagem automática de aniversário, os dados e a marca da empresa, a assinatura, os pedidos de LGPD e as chaves de integração. Tudo isso fica no hub **Configurações**.

## Onde fica
O botão **Configurações** fica fixo no rodapé do menu lateral. Dentro dele, as telas estão em seções:
- **Sua empresa:** **Equipe** (todos veem), **Distribuição de atendimento** (gerente ou administrador), **Aniversários** (gerente ou administrador), **Organização** (só administrador), **Marca** (só administrador), **Assinatura** (só administrador). Os **Tipos de agendamento** e **Profissionais da agenda** também ficam aqui (veja a página da Agenda).
- **Sua conta:** Perfil, Segurança e Notificações (veja a página "Sua conta").
- **Dados e acesso:** **LGPD** e **API Tokens** — só administrador.

## Papéis (quem pode o quê)
- **Somente leitura** (leitor): vê, mas não altera.
- **Atendente**: atende conversas e trabalha nos Kanbans.
- **Gerente**: tudo do atendente, mais disparos em massa, fluxos, agentes de IA, distribuição e relatórios da equipe.
- **Administrador**: tudo, inclusive conexões de WhatsApp, equipe, marca, assinatura, LGPD e API Tokens.

## Passo a passo
### Adicionar alguém à equipe
1. Abra **Configurações › Equipe** e clique em **Criar usuário** (só administrador vê o botão).
2. Preencha **E-mail**, **Nome**, uma **Senha** (mínimo de 8 caracteres) e o **Papel**.
3. Confirme. A pessoa já entra com esse e-mail e senha — nenhum e-mail é enviado, então passe os dados a ela.
4. Se a pessoa já tinha conta no sistema, ela entra na equipe com a senha que já usava.

### Mudar o papel, editar ou remover alguém
1. Em **Equipe**, aba **Membros**, troque o papel no seletor ao lado do nome.
2. Para mudar nome, e-mail ou definir uma senha nova, use **Editar usuário**.
3. Para tirar o acesso, abra o menu de ações e clique em **Revogar acesso**.

### Definir horários de atendimento da equipe
1. Em **Equipe**, abra a aba **Atendimento** (gerente ou administrador).
2. Na tabela de atendentes, veja status, carga e capacidade. Use **Editar horário** ao lado do nome para cadastrar as janelas da jornada semanal e o **Telefone de aviso (WhatsApp)**.
3. Sem janelas publicadas, a Agenda não oferece horário com essa pessoa.

### Escolher como os clientes novos são distribuídos
1. Abra **Configurações › Distribuição de atendimento**.
2. Em **Quem recebe o cliente novo**, escolha **Cada um pega o que quiser** (fila aberta) ou **Rodízio automático entre os atendentes**.
3. Em **O que cada atendente enxerga**, escolha **Todos veem tudo**, **Os seus, mais os que ainda não têm dono** ou **Só os seus**. Isso só restringe quem tem o papel Atendente; gerente e administrador continuam vendo tudo.
4. Clique em **Salvar**.

### Ligar o parabéns automático de aniversário
1. Abra **Configurações › Aniversários** e ligue **Enviar parabéns automaticamente**.
2. Escolha o **Horário do envio**, **Por qual WhatsApp enviar** e escreva a mensagem (use `{{primeiro_nome}}`). Na API oficial, escolha um modelo aprovado.
3. Salve. A data vem do campo **Data de nascimento** do contato (ou da coluna da planilha de importação).

### Atualizar os dados da empresa
1. Abra **Configurações › Organização**.
2. Ajuste **Nome de exibição**, **Razão social**, **DPO email** (encarregado de dados), **Fuso horário**, **Retenção de mídia (dias)**, **URL política de privacidade** e os **Motivos de perda extras**.
3. Clique em **Salvar**.

### Trocar o nome, a cor e o logo da empresa
1. Abra **Configurações › Marca**.
2. Preencha **Nome da sua empresa**, escolha a **Cor da sua marca** e, se quiser, suba o logo.
3. Salve. O nome e o logo aparecem no menu lateral para quem trabalha aqui; a tela de entrada continua com a marca de quem instalou o sistema.

### Ver e pagar a assinatura
1. Abra **Configurações › Assinatura**. Veja o plano, a situação, a próxima cobrança e as faturas.
2. Use **Assinar agora**, **Pagar agora** (PIX ou cartão), **Trocar forma de pagamento** ou **Ver fatura**.
3. Para cancelar, clique em **Cancelar assinatura**. O acesso continua até o fim do período pago.

### Atender um pedido de LGPD
1. Abra **Configurações › LGPD** ("Solicitações LGPD"). Filtre por status, tipo e prazo.
2. Abra a solicitação, use **Pré-visualizar dados** e aprove: **Aprovar export** (exportação dos dados) ou **Aprovar anonimização** (irreversível).
3. Quando a exportação fica pronta, use **Baixar PDF**. O prazo de cada etapa aparece na linha do tempo.
4. Para anonimizar um contato direto, abra o contato em **CRM › Contatos**, aba **LGPD**, e use **Anonimizar contato**.

### Criar uma chave de API para outro sistema
1. Abra **Configurações › API Tokens** e clique em **Criar novo token**.
2. Dê um nome, marque o que o token pode fazer (ler contatos, criar leads, enviar mensagens etc.) e, se quiser, um prazo de expiração.
3. Clique em **Criar token** e copie na hora: ele é mostrado uma única vez.
4. Para desativar, use **Revogar**.

## Dúvidas comuns
- **Onde convido alguém?** Em **Configurações › Equipe › Criar usuário** (só administrador). Você define o e-mail e a senha e passa para a pessoa.
- **Por que o atendente não vê todas as conversas?** Por causa de **O que cada atendente enxerga**, em **Distribuição de atendimento**. Com "Os seus, mais os que ainda não têm dono", ele vê só as próprias e as sem responsável; com "Só os seus", nem a fila.
- **Escolhi "Só os seus" e ninguém recebe nada.** Combine com o **Rodízio automático**: sem alguém distribuindo, ninguém recebe cliente novo e as telas ficam vazias.
- **Por que não vejo Organização, Marca, Assinatura ou LGPD?** Essas telas são só para administrador.
- **Revoguei o acesso de alguém por engano.** Dá para desfazer adicionando a pessoa de novo.
- **Perdi o token de API.** Ele não é mostrado de novo. Revogue o antigo e crie outro.
- **A anonimização pode ser desfeita?** Não. Ela é irreversível: o nome vira "Contato Anonimizado #N", e-mail, telefone e CPF são limpos e o conteúdo das atividades é apagado, mantendo só as datas do histórico. Para confirmar, o sistema pede uma justificativa.
