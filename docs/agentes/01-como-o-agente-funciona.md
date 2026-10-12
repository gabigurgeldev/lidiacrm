# 01 — Como o agente funciona

> Este documento descreve o **motor canônico** (`lib/agent-engine`, rodando no serviço `worker`). Existe um runtime antigo (`lib/ai/runtime/agent.ts` + `lib/ai/dispatcher`) marcado como **deprecated** — hoje ele só é usado pelo botão **Teste** do editor e pelo onboarding. Quando o comportamento dos dois difere, isso está indicado.

---

## 1. Os três papéis de um agente

Um agente não é uma coisa só. A tela de configuração tem três abas, e cada uma é um papel diferente:

| Aba na tela | Papel | O que faz | Fala com o cliente? |
|---|---|---|---|
| **Conversa com o cliente** | **Conversador** | Lê a conversa, responde, consulta o acervo, usa as capacidades ligadas, agenda retorno, chama humano. | Sim — é o único que fala |
| **Organiza o sistema** | **Operador** | Depois de cada turno, lê o que o Conversador declarou e mexe no CRM: abre chamados, distribui, organiza marcadores e etapas. | **Nunca** — ele não tem a ferramenta de envio |
| **Confere antes de enviar** | **Segurança** | Cadeia de conferências que roda antes de cada mensagem sair. Barra e devolve o motivo para o Conversador reescrever. | Não — só barra ou libera |

Por que separar: medido em produção, quando um único contexto servia para conversar **e** operar, cerca de 30% das respostas vazavam vocabulário interno ("vou chamar crm_move_lead_stage…") para o cliente. Separar os papéis — e tirar do Conversador as ferramentas que o Operador assumiu — derrubou isso.

---

## 2. O caminho de uma mensagem, passo a passo

### 2.1. Da mensagem ao job

1. O cliente manda mensagem. O canal (WAHA, Meta Cloud ou parceiro) entrega ao CRM, que grava em `messages` e emite um evento de despacho no `event_log`.
2. O **drain** do agente (`lib/agent-engine/edge/crm/drain.ts`) consome esse evento e cria um job `inbound_turn` na fila durável (`job_queue`).
   - **Junta rajadas:** mensagens do mesmo cliente dentro de `INBOUND_DEBOUNCE_MS` (padrão **8 segundos**) viram **um** job só. O turno lê o histórico completo e responde a todas de uma vez.
   - **Grupos são ignorados:** conversa `@g.us` não gera job.
   - **Sem duplicata:** o mesmo evento nunca gera dois jobs (`unique (organization_id, source_event_id)`).
3. O worker pega o job (até `QUEUE_MAX_CONCURRENCY`, padrão 8, em paralelo) e executa o turno.

### 2.2. As guardas de entrada (antes de gastar IA)

Na ordem em que rodam (`lib/agent-engine/agent/inbound-turn.ts`):

| # | Guarda | O que acontece |
|---|---|---|
| 1 | **Orçamento de IA** da organização | Se o teto mensal estourar a qualquer momento do turno, a conversa **passa para humano** com um aviso ao cliente e um item na Central ("Teto de gasto com IA atingido — assumir a conversa"). Nunca vira silêncio. |
| 2 | **Cliente em atendimento humano** | Se a conversa está com uma pessoa (`force_human` / `bot_silenced_until`), o turno não faz nada. O agente **nunca** reassume sozinho. |
| 3 | **Janela anti-banimento** (padrão 7h–22h, fuso da organização, configurável por número) | Fora dela o turno é **adiado** para a abertura da janela — quem escreveu às 22h30 é respondido às 7h. Não é descartado. |
| 4 | **Roteador** | Se o número tem roteador ativo, ele decide qual agente atende (ver [04](04-roteadores.md)). Senão, atende o agente publicado daquele número com maior "Ordem de preferência". |
| 5 | **Horário de funcionamento do agente** (campo da tela) | Só no turno de mensagem recebida. Fora do horário, o turno é **adiado** para a abertura. Follow-ups prometidos não são segurados por ele (só pela janela anti-ban). |

### 2.3. Montagem do contexto

O modelo recebe, nesta ordem:

**Parte fixa (igual para todos os clientes da organização — fica em cache no provedor):**
1. **Playbook em camadas:** plataforma (regras de transparência e tom, `lib/agent-engine/playbooks/platform.md`) → **instruções do agente** (o campo "As instruções dele") → campanha, quando houver.
2. **Memória da empresa** (`/app/ai/memory`): regras e aprendizados que valem para todo atendimento.
3. **Índice de skills** (nome + descrição de cada skill instalada).
4. Bloco de **casos humanos**, se "Pedir ajuda sem sair da conversa" estiver ligado.
5. As definições das ferramentas.

**Parte por cliente (muda a cada turno):**
6. **Checkpoint anterior:** compromissos, objeções, próxima ação e resumo acumulado.
7. **Estado do funil** do cliente (novo → … → ganho/perdido).
8. **Memória do cliente:** índice das notas duráveis (`lead_notes`).
9. **Histórico:** as últimas N mensagens ("Mensagens anteriores que ele lê"), cortadas pelo tamanho máximo ("Tamanho máximo desse histórico").
10. **Corpo das skills que casaram** com a última mensagem.
11. **Dica de etapa** do classificador auxiliar (sugestão, não decisão).
12. Instrução de **estilo** (bolhas curtas ou áudio), quando ligada. Com "Só quando o cliente mandar áudio", o turno só escreve para ser ouvido se o cliente mandou áudio desde a última resposta.
13. O caso que está **aguardando resposta do cliente**, se houver.
14. **Mídia** recente como imagem/arquivo nativo, se o modelo suportar; senão, o texto derivado (transcrição/descrição).

**Integrações via API (pré-turno):** se o agente tem sistemas externos marcados, **antes** do modelo o runtime confere, nas mensagens gravadas, o **código de verificação** que o cliente digitou e o **SIM** de uma correção proposta. Se o SIM vale, a correção é executada ali mesmo, com os parâmetros congelados — o modelo só recebe o resultado. Ver [10 §4](10-integracoes.md).

**Auxiliares em paralelo:** o classificador de etapa e o detector de manipulação rodam **juntos** e são de melhor esforço — se um falhar ou demorar, o turno segue sem ele.

**Compactação:** quando a conversa passa de `COMPACTION_TRIGGER_MESSAGES` (padrão 40 mensagens), antes de responder o sistema grava as notas duráveis e resume o histórico com um modelo mais barato. O agente continua lembrando o combinado sem pagar pela conversa inteira.

### 2.4. Desvios determinísticos (sem IA)

Antes de chamar o modelo, duas detecções por regra fixa:

| Detecção | Gatilho | O que o sistema faz |
|---|---|---|
| **Pedido de humano** | Regex em português ("falar com atendente", "pessoa real"…) **ou** uma das "Palavras que chamam uma pessoa na hora" configuradas no agente | 1) manda ao cliente um aviso de que alguém da equipe vai assumir; 2) passa para humano; 3) encerra o turno. |
| **Suspeita de opt-out** | "para de me mandar", "não quero mais receber", "me tira da lista", ou STOP/PARAR/SAIR sozinhos | 1) confirma ao cliente que as mensagens param e que uma pessoa vai conferir; 2) silencia o agente e cancela retornos agendados; 3) abre item na Central para um humano confirmar o bloqueio real. |

A ordem importa: **avisa e só então silencia**. Silenciar primeiro faria a própria trava vetar o aviso.

### 2.5. O loop do modelo

O modelo decide livremente quais ferramentas usar, até o limite de **"Ações por atendimento"** (`max_steps`, 1 a 25). Regras impostas pelo motor, não pelo prompt:

- **Texto solto do modelo nunca vira mensagem.** Só sai para o cliente o que passar pela ferramenta `send_message` (ou `send_template`).
- **No máximo 3 mensagens físicas por turno** (`MAX_SENDS_PER_TURN`). Medido em produção: sem esse teto um cliente recebeu 8 mensagens seguidas.
- **Disjuntor de ferramentas:** chamar a mesma ferramenta com os mesmos argumentos repetidamente, ou sem progresso, gera aviso e depois bloqueio.
- **Cada envio passa pela cadeia de conferências** (ver [08](08-seguranca-guardrails-anti-ban.md)). Se uma conferência barra, o motivo volta ao modelo como instrução para reescrever — não é erro.
- **Movimento de funil é marcado pelo modelo e validado pelo código.** A ferramenta `update_lead_state` só aceita o **próximo** estágio válido (`new → contacted → qualifying → qualified → negotiating → won | lost`); regressão é recusada. O avanço é espelhado no card do CRM conforme a tradução configurada no funil (ver [02 §4](02-criar-e-configurar-agente.md)).

### 2.6. Fechamento do turno (checkpoint)

Depois do loop, o motor faz **uma segunda chamada** ao modelo pedindo **só** um JSON com:

- `commitments` — compromissos assumidos;
- `objections` — objeções do cliente;
- `next_action` — próxima ação combinada;
- `rolling_summary` — resumo acumulado da conversa;
- `declaracao` — o que o cliente **quer** (intenções, com evidência) e o que foi **prometido** (promessas, com prazo).

Isso é imposto pelo runtime, não depende do modelo lembrar. A linha do tempo do cliente recebe só a **diferença** em relação ao checkpoint anterior.

O checkpoint é de **melhor esforço**: a resposta ao cliente já saiu quando ele roda. Se o provedor travar ou falhar aqui, o turno registra o problema e termina mesmo assim — perder o resumo de um turno custa memória; prender o job seguraria a próxima mensagem do cliente.

### 2.6.1. Tempos-limite das chamadas de modelo

Nenhuma chamada fica pendurada para sempre (antes, um provedor que não respondia prendia a fila do cliente por quase uma hora):

| Chamada | Teto padrão | Variável |
|---|---|---|
| Turno do agente (todos os passos) | 120 s | `LLM_TIMEOUT_MS` |
| Classificadores auxiliares | 20 s | `LLM_TIMEOUT_CLASSIFICADOR_MS` |
| Resumo / checkpoint | 90 s | `LLM_TIMEOUT_RESUMO_MS` |

O worker procura mensagens novas a cada 2 s quando há trabalho e a cada **3 s** quando está ocioso (`CRM_DRAIN_IDLE_INTERVAL_MS`).

### 2.7. O turno do Operador

Se o papel "Organiza o sistema" estiver **ligado** e o agente estiver **publicado**, o runtime enfileira um job `operator_turn` logo depois de gravar o checkpoint. O Operador:

- lê a **declaração** do Conversador;
- se a declaração diz `nada_a_declarar`, registra "nada a fazer" **sem chamar modelo** (economia);
- se a declaração veio **ausente** (fechamento incompleto), ele roda mesmo assim — é justamente quando pode ter ficado promessa sem dono;
- usa **só** as capacidades da lista dele ("O que ele pode mexer no sistema"), independentes das do Conversador;
- usa o modelo próprio ou herda o do Conversador.

Com o papel **desligado**, o básico continua sendo registrado (etapa do cliente, retorno prometido, histórico). O que deixa de acontecer é a **decisão sobre a operação**: abrir chamados, distribuir, organizar marcadores e etapas.

Promessa feita ao cliente que **ninguém assumiu** vira item na Central: "O assistente prometeu algo a um cliente e ninguém ficou responsável".

---

## 3. Os tipos de turno

| Job | Quando nasce | Fala com o cliente? |
|---|---|---|
| `inbound_turn` | Cliente mandou mensagem | Sim |
| `followup_turn` | Um retorno agendado venceu, ou um passo de fluxo de follow-up pediu (mensagem, classificação, plano de tempo) | Só quando o propósito é enviar mensagem |
| `case_reply_turn` | Uma pessoa respondeu a um caso aberto pelo agente ("Concluí" ou "Preciso de info do cliente") | Sim |
| `operator_turn` | Fim de um turno do Conversador, com papel Operador ligado | Nunca |

Todos reusam o mesmo motor. A diferença está na abertura: o `followup_turn` injeta um bloco do tipo "passaram 3 dias desde a última resposta, você prometeu X, o último que o cliente disse foi Y"; o `case_reply_turn` injeta a decisão da pessoa sobre o caso.

---

## 4. Memória — o que o agente lembra e por quanto tempo

| Camada | Escopo | Quem escreve | Onde se vê |
|---|---|---|---|
| Playbook (plataforma + instruções do agente) | Organização / agente | Plataforma e você | Editor do agente |
| Memória da empresa | Todos os agentes da organização | Você (manual) ou o agente (`crm_save_org_memory`, marcado "aprendido automaticamente") | `/app/ai/memory` |
| Skills | Organização, por situação | Catálogo da plataforma ou upload `.zip` | `/app/ai/skills` |
| Acervo (RAG) | Os materiais marcados no agente | Você | `/app/ai/knowledge/sources` |
| Checkpoint | Por cliente, por turno | Runtime (2ª chamada do turno) | Linha do tempo (diferenças) |
| Notas do cliente | Por cliente, permanente | O agente (`save_lead_note`), consolidando antigas | Lidas pelo agente sob demanda |
| Histórico | Por conversa | Canal | Caixa de entrada |

Detalhes em [09](09-conhecimento-memoria-skills.md).

---

## 5. Quando não há agente publicado no número

Se nenhum agente publicado atende aquele número (e não há roteador, ou o roteador não tem para quem mandar), o turno roda com o **agente genérico**: playbook da plataforma + configuração de IA da organização (`organizations.settings.llm`) + parâmetros do servidor. Se a organização também não tem modelo configurado, cada turno falha — e isso aparece como "Uma tarefa do assistente falhou e parou de tentar" na Central.

> **Dica:** sempre tenha um agente publicado por número conectado, mesmo que simples.

---

## 6. Garantias que o motor dá (independentes da configuração)

- O agente **nunca** reassume uma conversa que está com humano; só uma pessoa devolve.
- Opt-out (`contacts.is_blocked`) é **irrevogável** pelo agente; nada sai por cima.
- Toda mensagem passa pela cadeia de conferências; não existe envio "por fora".
- Identificadores de organização e cliente vêm sempre da linha do job, nunca do que o modelo escreveu.
- Dados pessoais não vão para logs.
- Um erro numa peça acessória (roteador, telemetria, capacidade extra) **não derruba** a resposta ao cliente: o turno degrada para o caminho mais simples e registra o motivo.
- Turno que falha é re-tentado pela fila; envio já feito não se repete (registro por `(job, seq)`).

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Turno principal | `lib/agent-engine/agent/inbound-turn.ts` |
| Escolha do agente / roteador | `lib/agent-engine/agent/resolve-turn-agent.ts`, `router-config.ts`, `intent-classifier.ts` |
| Configuração publicada lida a cada turno | `lib/agent-engine/agent/agent-config.ts` |
| Operador | `lib/agent-engine/agent/operator-turn.ts`, `declaracao.ts`, `entrega-de-capacidade.ts` |
| Follow-up e casos | `followup-turn.ts`, `case-reply-turn.ts`, `human-cases.ts` |
| Cadeia de envio | `lib/agent-engine/guardrails/before-send.ts` |
| Ritmo / janela | `lib/agent-engine/pacing/` |
| Fila | `lib/agent-engine/queue/` |
| Variáveis do worker | `lib/agent-engine/env.ts` (ver todas: `grep -oE "^\s+[A-Z_]{4,}:" lib/agent-engine/env.ts`) |

A configuração do agente é lida **a cada turno**, sem cache: publicar na tela vale a partir da próxima mensagem, sem reiniciar nada.
