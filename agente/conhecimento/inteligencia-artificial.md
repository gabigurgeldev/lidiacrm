# Inteligência Artificial (Central de IA)

Rotas: /app/ai, /app/ai/agents, /app/ai/followups, /app/ai/routers, /app/ai/coordenador, /app/ai/credentials, /app/ai/providers, /app/ai/integracoes, /app/ai/knowledge/sources, /app/ai/memory, /app/ai/skills, /app/ai/cases, /app/ai/inbox, /app/ai/proposals, /app/ai/runs, /app/ai/usage

## O que é
O grupo **Inteligência Artificial** reúne tudo que define quem atende por você no WhatsApp — os **agentes de IA** — e como acompanhar o que eles fazem. Um agente responde às conversas sozinho, seguindo as instruções e os materiais do seu negócio, e passa para uma pessoa quando precisa. A **Central de IA** é o hub com todas as telas do grupo, organizadas em "Montar o agente", "Ensinar o agente" e "Acompanhar o agente".

## Onde fica
- No menu lateral: **Inteligência Artificial › Agentes**, **Follow-ups** e **Roteadores** (gerente ou administrador).
- As demais telas ficam em **Inteligência Artificial › Central de IA** (a página se chama "Agente de IA").
- Quem é Atendente ou Somente leitura não vê o grupo no menu lateral: a **Central de avisos** abre pelo sino no topo da tela, e **Casos** e **Propostas** pela busca do topo (Ctrl+K ou ⌘K).
- **Montar o agente:** Agentes, Follow-ups, Roteadores, Coordenador, Credenciais, Provedores, Integrações via API — gerente ou administrador.
- **Ensinar o agente:** Conhecimento, Memória, Skills — gerente ou administrador.
- **Acompanhar o agente:** Casos (atendente, gerente ou administrador), Central de avisos e Propostas (todos), Execuções e Uso e orçamento (gerente ou administrador).
- Criar um agente novo é só para administrador.

## Passo a passo
### Antes de tudo: cadastrar a chave de IA
1. Abra **Central de IA › Credenciais** e clique em **Adicionar credencial**.
2. Cole a chave da sua conta no provedor de IA (você contrata direto com o provedor; a cobrança vai para a sua conta lá).
3. Clique em **Salvar e validar**. A chave fica guardada com segurança e não aparece de novo na tela.

### Criar um agente com ajuda da IA
1. Abra **Inteligência Artificial › Agentes** e clique em **Criar com IA**.
2. Em **Conte sobre o negócio**, cole o que tiver: o que a empresa faz, produtos e preços, horários, formas de pagamento, políticas, dúvidas frequentes. Dá para anexar PDF, MD ou TXT.
3. Responda às perguntas do assistente (ou clique em **Pular perguntas e montar agora**).
4. Revise a prévia e o que ficou em aberto. Peça ajustes no chat, se quiser, e crie o agente. Ele nasce como **rascunho**.
5. Se preferir montar à mão, use **Novo agente**.

### Configurar, testar e publicar um agente
1. Em **Agentes**, clique no agente. A aba **Configuração** tem as seções: quem é, as instruções, a inteligência (modelo e chave), por qual número ele atende, quando ele entra em ação, estilo de resposta, passar para uma pessoa, o que ele consulta, em que Kanbans ele pode mexer, habilidades e capacidades.
2. Clique em **Salvar rascunho**. O que você salva vira rascunho até publicar.
3. Na aba **Teste**, escreva como se fosse o cliente e veja a resposta. Nada é enviado ao cliente nem gravado no CRM.
4. Clique em **Publicar** e confirme. A versão publicada passa a atender.
5. Na aba **Histórico** dá para comparar versões e voltar a uma anterior.

### Pausar, duplicar ou arquivar um agente
1. Na lista de **Agentes**, abra o menu de ações do agente.
2. Escolha **Pausar** (ele para de responder; **Despausar** volta), **Duplicar**, **Renomear** ou **Arquivar**.

### Corrigir um comportamento do agente
1. No agente, clique em **Corrigir com IA**.
2. Em **Conte o problema**, descreva o que está errado (ex.: está dando desconto sem autorização).
3. A correção vira um novo rascunho. Teste e publique no editor; a versão anterior fica no histórico.

### Ensinar o agente sobre o seu negócio
1. Abra **Central de IA › Conhecimento** e clique em **Adicionar material** (perguntas frequentes, políticas, catálogo, fotos).
2. No agente, na seção do que ele consulta, marque quais materiais ele pode ler.
3. Em **Central de IA › Memória**, escreva regras que valem para TODOS os agentes (ex.: "Nunca prometa desconto sem confirmar com um humano") e publique a versão.

### Retomar conversas que esfriaram (Follow-ups)
1. Abra **Inteligência Artificial › Follow-ups** e clique em **Novo fluxo**.
2. Escolha o gatilho (silêncio, etapa do Kanban, automação em Webhooks ou o agente pediu ajuda) e monte as etapas no editor visual.
3. Publique. No agente, ligue **Habilitar gatilhos automáticos de follow-up** e escolha os fluxos publicados.
4. A aba de fila mostra quem está em follow-up e quando será o próximo envio.

### Vários agentes no mesmo número (Roteadores e Coordenador)
1. **Roteadores:** clique em **Novo roteador**, escolha o número de WhatsApp e cadastre as intenções (ex.: comprar, suporte) e qual agente atende cada uma.
2. **Coordenador:** decide quem conduz cada conversa — agente, fluxo ou equipe — para o cliente não ouvir duas vozes. Comece em **Observar** (só registra o que faria) antes de passar para **Ativo**.

### Responder quando a IA precisa de você
1. **Casos:** quando a IA trava em algo que só um humano resolve, ela abre um caso. Abra, leia o que o cliente precisa e responda; a IA continua a conversa.
2. **Central de avisos:** conexões caídas, tarefas que falharam e atendimentos passados a pessoas. Resolva e clique em **Marcar resolvido**. O sino no topo da tela leva para cá.
3. **Propostas:** melhorias que a IA sugere. Aprove ou ignore — nada é aplicado sozinho.

## Dúvidas comuns
- **O agente não responde ninguém. Por quê?** Confira se ele está **publicado** (rascunho não atende), se tem um número conectado na seção do número, se a chave em **Credenciais** é válida e se ele não está pausado. Depois veja **Central de IA › Execuções**, que mostra o que aconteceu quando algo falhou.
- **Quanto a IA está gastando?** Veja **Central de IA › Uso e orçamento**: custo no período, atendimentos, tempo de resposta e quantas vezes chamou uma pessoa nos últimos 30 dias.
- **Como faço o agente passar para um humano?** Na seção **Passar para uma pessoa** do agente, ligue a opção e cadastre **Palavras que chamam uma pessoa na hora**. Na conversa, qualquer atendente pode clicar em **Assumir**.
- **O agente pode mover o lead no Kanban?** Sim, nos Kanbans marcados na seção "Em que negócios ele pode mexer". As etapas para onde ele leva o card são definidas em **Configurar** no próprio Kanban.
- **O agente pode responder em áudio?** Sim, em **Estilo de resposta › Responder em áudio**. Exige uma chave de provedor compatível cadastrada.
- **Para que servem Provedores e Integrações via API?** **Provedores** define qual inteligência atende cada parte do sistema e o que acontece se ela falhar. **Integrações via API** conecta sistemas seus para o agente consultar dados reais (um pedido, um status); correções só rodam depois que o cliente confirma.
- **O que são Skills?** Habilidades especializadas que o agente só carrega quando a conversa pede. Instale prontas do catálogo ou envie a sua (.zip).
- **Não vejo a Central de IA.** As telas de montar e ensinar o agente são para gerente ou administrador. Atendentes veem Casos, Central de avisos e Propostas — pelo sino no topo e pela busca (Ctrl+K ou ⌘K).
