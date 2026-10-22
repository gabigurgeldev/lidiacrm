# 07 — Passagem para humano, chamados e distribuição de atendentes

Três mecanismos diferentes, que se confundem com frequência:

| Mecanismo | A IA continua na conversa? | Para quê |
|---|---|---|
| **Passagem para humano (handoff)** | **Não.** O agente silencia até uma pessoa devolver. | O cliente pediu gente, assunto sensível, cliente irritado, orçamento de IA esgotado. |
| **Caso / "Pedir ajuda sem sair da conversa"** | **Sim.** | O agente precisa de uma decisão (desconto, liberação) e segue conversando enquanto espera. |
| **Distribuição de atendentes (roteamento)** | — | Quem da equipe recebe a conversa que entra na fila. |

---

## Parte A — Passagem para humano

### A.1. O que dispara

| Gatilho | Onde | Usa IA? |
|---|---|---|
| Cliente pede atendente ("quero falar com uma pessoa", "atendente"…) | Detecção fixa em português, antes do modelo | Não |
| Mensagem contém uma das **Palavras que chamam uma pessoa na hora** do agente | Configuração do agente | Não |
| Suspeita de opt-out ("para de me mandar", "me tira da lista", STOP sozinho) | Detecção fixa | Não |
| Cliente manda **foto**, com **"Quando o cliente mandar uma foto, passar para uma pessoa"** ligado no agente (migration 0243) | Detecção fixa, antes do modelo (`lib/agent-engine/agent/foto-do-cliente.ts`) — só foto do cliente desde a nossa última mensagem; figurinha e resposta citando foto nossa não contam | Não |
| O **modelo** decide que não é caso dele | Ferramenta `request_human_handoff` (se "Deixar o agente chamar uma pessoa" estiver ligado) | Sim |
| **Cliente irritado** — sentimento abaixo do limiar (padrão **0,3**) | Classificador de sentimento em toda mensagem recebida | Sim (ponto "Medir o clima da conversa") |
| **Orçamento de IA** da organização esgotado | Qualquer chamada recusada pelo teto | Não |
| Correlação: tentativa de manipulação **alta** + tentativa de promessa fora da tabela no mesmo turno | Guardrails | Sim (só se a camada de jailbreak estiver ligada) |
| Caso escalado por uma pessoa ("Não consigo — passar pra humano") | Tela de Casos | Não |

Notas sobre o sentimento:
- Respostas secas ("não", "vou não", "sim") **não** são classificadas — eram lidas como irritação e escalavam à toa.
- Sem nenhum agente **no ar** na organização, o classificador de sentimento **não roda** (quem não ligou a IA não recebe efeito da IA).
- O limiar vem de `ai_agents.config.sentiment_threshold` do agente no ar (padrão 0,3).

### A.2. O que acontece, na ordem

1. **O cliente é avisado.** O sistema manda uma frase de acordo com o motivo e com a disponibilidade real da equipe (consultada na hora, não "lembrada" pelo modelo):

   | Motivo | Exemplo de abertura |
   |---|---|
   | Pediu humano | "Claro! Já estou chamando alguém da equipe para falar com você." |
   | Suspeita de opt-out | "Entendi. Vou parar de te enviar mensagens automáticas por aqui." + "Encaminhei seu pedido para uma pessoa da equipe confirmar." |
   | Orçamento de IA | "Vou passar seu atendimento para uma pessoa da equipe." |
   | Cliente mandou foto | "Recebi sua foto! Vou pedir para alguém da equipe conferir e te responder." |
   | Outro | "Esse caso é melhor resolvido por uma pessoa. Já acionei o time." |

   | Situação da equipe | Fecho |
   |---|---|
   | Alguém disponível agora | "É só aguardar um instante aqui na conversa." |
   | Há equipe, mas ninguém disponível | "No momento ninguém está disponível, mas seu pedido ficou registrado." |
   | Nenhuma equipe configurada | "Seu pedido ficou registrado e a equipe responde assim que possível." |

   Cada cliente recebe sempre a mesma variante (escolhida pelo id do contato), para não parecer robô repetindo frases diferentes.

   Quando é o **modelo** que chama a passagem: ele deve avisar antes. Se não tiver falado nada no turno, o sistema manda o aviso padrão; se já falou, não repete.

2. **As três travas são armadas:**
   - `contacts.force_human = true` — o motor não roda turno e a cadeia de envio veta qualquer mensagem automática;
   - `conversations.assignee_kind = 'user'` / conversa volta à fila;
   - `conversations.bot_silenced_until = infinito`.
3. **Retornos agendados** do contato são cancelados; **fluxos de follow-up** aplicam a política de handoff (pausar/cancelar/permitir).
4. Um item entra na **Central de avisos** ("O assistente passou um atendimento para um humano"), com o **resumo** do checkpoint (o que foi combinado, objeções, próxima ação) — a pessoa não precisa ler a conversa inteira.
5. Evento `agent.handoff_requested` — que pode disparar **Fluxos** com o gatilho "Quando a IA passar para uma pessoa" (ex.: avisar o gestor no WhatsApp).

### A.3. Devolver ao agente

Só uma **pessoa** (ou um fluxo com o bloco "Entregar a conversa para a IA") devolve. O agente **nunca** se auto-libera.

- Na conversa: botão **"Devolver ao automático"** no cabeçalho.
- Capacidade `crm_resume_ai_attendance` (só pessoa, via MCP/API).
- Bloco de fluxo `crm.handoff_to_agent`.

Todos usam a mesma regra (`lib/escalacao/retomada.ts`): solta **as três travas**, leva junto o que ficou combinado com o cliente e **fecha o aviso** de handoff na Central. O próximo turno do agente lê um resumo do que a pessoa fez (`lib/escalacao/continuidade.ts`: decisões em casos, notas internas, estado dos casos) — o cliente não precisa repetir nada.

> Se o motivo foi orçamento: aumente o teto em **IA › Uso e orçamento** antes de devolver; senão a próxima mensagem cai no mesmo bloqueio.

### A.4. Quem responde pelo celular da loja assume a conversa

Responder pelo **composer do CRM** silencia o automático por 5 minutos, renovados a cada mensagem. Responder pelo **WhatsApp do celular** da loja (o mesmo número conectado) **pausa o automático daquela conversa até alguém devolver** — o agente não fala mais por cima do atendente. A pausa não trava o contato (`force_human` fica como está), só a conversa, e aparece na linha do tempo do negócio.

Para devolver **pelo próprio celular**, mande na conversa a mensagem **`#ia`** (também valem `#bot`, `#robo` e `#automatico`; tem de ser a mensagem inteira). O comando passa pela mesma regra do botão "Devolver ao automático" e não entra no histórico que o agente lê. O cliente vê o `#ia` — apague para todos, se preferir.

O eco das mensagens que o próprio CRM manda (IA, composer, fluxo) não pausa: a regra ignora o webhook quando a conversa tem um envio do CRM ainda sem id há menos de 2 minutos (`lib/escalacao/celular-da-loja.ts`).

---

## Parte B — Casos ("Pedir ajuda sem sair da conversa")

Ligue no agente: **"Deixar o agente pedir uma tarefa a alguém e seguir conversando"** (`cases_enabled`). Tela: **IA › Casos** (`/app/ai/cases`).

### B.1. Como funciona

1. O agente esbarra num bloqueio e chama `open_human_case` com **título**, **o que o cliente precisa** e **por que ele não consegue resolver**.
2. O caso nasce **"Aguardando você"**. O agente **continua** conversando (não silencia) e diz ao cliente o que esperar — a resposta da ferramenta já traz a expectativa real de atendimento (há alguém disponível? em quanto tempo?).
3. Só existe **um caso aberto por conversa**.
4. Na tela de Casos, a pessoa vê "O que o cliente precisa", "Por que a IA travou", a linha do tempo, e responde com uma das três ações:

| Ação na tela | O que a IA faz | Estado do caso |
|---|---|---|
| **Concluí** (+ texto) | "A IA avisa o cliente e encerra o assunto." Roda um turno que comunica a solução. | Concluído |
| **Preciso de info do cliente** (+ a pergunta) | "A IA pergunta ao cliente e o caso volta pra você quando ele responder." | Aguardando o cliente |
| **Não consigo — passar pra humano** | "Sai da IA: a conversa vira um atendimento humano de verdade." | Virou atendimento humano (handoff completo) |

5. Quando o caso está "Aguardando o cliente" e ele responde, o agente repassa a informação com `provide_case_update` e o caso volta a "Aguardando você".

### B.2. Garantia: nada de promessa vazia

Com casos ligados, a conferência **"Não prometer atendimento humano que não existe"** barra mensagens como "vou pedir para o responsável te ligar" se **não houver caso aberto**. Na primeira vez ela ensina o modelo a abrir o caso ou reformular; se ele insistir, o **sistema abre um caso mínimo automaticamente** ("O sistema abriu o caso automaticamente") e só então libera a mensagem.

### B.3. Integra com follow-up

Um fluxo de follow-up com gatilho **"Agente pediu ajuda"** nasce quando o caso abre e é cancelado quando o caso fecha ([05](05-follow-ups.md)).

---

## Parte C — Distribuição de conversas para atendentes

Tela: **Distribuição de atendimento** (`/app/settings/atendimento`).

### C.1. Quem recebe o cliente novo

| Opção | Comportamento |
|---|---|
| **Cada um pega o que quiser** (manual, padrão) | Todo cliente novo cai numa fila aberta e o primeiro atendente que clicar assume. |
| **Rodízio automático entre os atendentes** (round_robin) | Cliente 1 para A, cliente 2 para B… entre os **elegíveis**; quem recebeu há mais tempo (ou nunca) vem primeiro. |

| Campo | Padrão | Limite | Efeito |
|---|---|---|---|
| **Tentativas antes de desistir** | 5 | 0–20 | Quando não há ninguém elegível, tenta de novo mais tarde. Ao estourar, a conversa fica na fila. |
| **Espera entre tentativas (segundos)** | 60 | 1–3600 | Intervalo entre tentativas. |

Vale para conversa que chega **sem dono**. Worker: cron `routing-worker` (1×/min) consome `conversation.routing_requested`; nunca reatribui conversa que já tem dono.

### C.2. Quem é elegível

Elegível = **disponível** ∧ **dentro do horário** da pessoa ∧ **abaixo da capacidade**. O heartbeat não entra na conta na hora de escolher: ele só serve para o cron desligar quem sumiu.

| Configuração por atendente | Detalhe |
|---|---|
| Disponível | Liga/desliga. Sem heartbeat por **15 minutos**, o atendente vira offline sozinho (cron `attendant-heartbeat`), exceto se estiver **sempre disponível**. |
| Sempre disponível | Só manager+ liga. O cron não a desliga por falta de heartbeat, e ela fica elegível durante o horário mesmo com o CRM fechado. Ligar a opção também liga a pessoa (`attendant_availability.always_available`, migration 0244). |
| Capacidade | 1 a 1.000 conversas abertas atribuídas simultâneas. |
| Agenda | Fuso (validado; ex.: `America/Asuncion` — sem acento) + janelas por dia da semana (início < fim). **Sem janelas = 24/7.** |
| Telefone de aviso | E.164 (`+5511…`). Usado pelo bloco "Avisar o vendedor no WhatsApp". |

A **mesma** regra alimenta: o roteamento de conversas, os blocos de distribuição dos Fluxos, a capacidade "Ver quem pode assumir agora", a fila (`crm_get_queue_status`) e o aviso ao cliente na passagem para humano.

### C.3. O que cada atendente enxerga

| Opção | Atendente (papel `agent`) vê |
|---|---|
| **Todos veem tudo** | Qualquer conversa e negócio. |
| **Os seus, mais os que ainda não têm dono** | A própria carteira + a fila. |
| **Só os seus** | Apenas o que foi direcionado a ele — nem a fila (combine com o rodízio). |

Gerente e administrador continuam vendo tudo. A regra é aplicada no banco (RLS), não só na tela.

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Passagem no motor | `lib/agent-engine/agent/human-handoff.ts`, `aviso-de-escalacao.ts` |
| Passagem no CRM (sentimento etc.) | `lib/ai/handoff/orchestrator.ts`, `workers/ai-handoff-from-sentiment.handler.ts`, `workers/ai-sentiment-worker.ts` |
| Texto ao cliente | `lib/escalacao/aviso-ao-lead.ts` |
| Disponibilidade | `lib/escalacao/disponibilidade.ts`, `atendentes.ts` |
| Devolver | `lib/escalacao/retomada.ts`, `continuidade.ts` |
| Casos | `lib/agent-engine/agent/human-cases.ts`, `case-reply-turn.ts`, `lib/escalacao/chamados.ts`, `lib/ai/case-copy.ts` |
| Roteamento | `lib/routing/{decide,eligibility,eligibles,queue,worker}.ts`, `lib/schemas/routing.ts` |

Tabelas: `agent_cases`, `agent_case_events`, `attendant_availability`, `conversation_assignment_events`, `organizations.settings.routing`, `organizations.settings.visibility_mode`.
