# 05 — Follow-ups

> Tela: **IA › Follow-ups** (`/app/ai/followups`) — lista de fluxos, construtor visual, aba de fila e o dossiê de cada acompanhamento.

O sistema tem **dois mecanismos** de follow-up, que convivem:

| | **Retorno agendado** | **Fluxo de follow-up** |
|---|---|---|
| Quem decide | O **agente**, durante a conversa ("te retorno amanhã às 10h") — ou uma pessoa | **Você**, desenhando um fluxo |
| Como nasce | Ferramenta nativa `schedule_followup` (ou capacidade `crm_schedule_followup`) | Gatilho: silêncio, etapa do funil, caso aberto, automação, manual |
| O que faz | No horário, roda **um turno completo do agente** com o contexto "você prometeu X" | Executa passos: esperar, classificar resposta, mandar mensagem, ramificar, repetir, terminar |
| Precisa ligar algo no agente? | Não (a ferramenta está sempre lá) | Sim, para gatilhos automáticos: **Follow-up habilitado** + o fluxo marcado num agente **publicado** |

Os dois aparecem juntos na aba **Fila**.

---

## Parte A — Retorno agendado pelo agente

### Como funciona

1. Na conversa, o agente promete voltar e chama `schedule_followup` com: **motivo**, **data/hora** (ISO, no futuro), **o que prometeu** e um contexto curto opcional.
2. O sistema valida e cria um agendamento único (`cron_jobs`, tipo `at`).
3. No horário (com um pequeno espalhamento anti-rajada de até 1 minuto), enfileira um `followup_turn`.
4. O turno abre com um bloco de reentrada: *"passaram N dias desde a última resposta, você prometeu X, motivo Y, a última coisa que o cliente disse foi Z"* — e o agente segue normalmente, com todas as conferências.

### Regras

| Regra | Padrão | Variável do servidor |
|---|---|---|
| Antecedência mínima | 5 minutos | `FOLLOWUP_MIN_AHEAD_MS` |
| Horizonte máximo | 180 dias | `FOLLOWUP_MAX_AHEAD_MS` |
| Espalhamento | até 60 s | `CRON_STAGGER_WINDOW_MS` |
| **Um retorno vivo por cliente** | — | Tentar agendar outro devolve "já existe retorno" (o agente é ensinado a não empilhar) |
| Janela anti-ban | 7h–22h | Se vencer fora da janela, o turno é **adiado** para a abertura |

Recusas que o modelo recebe como instrução (e corrige): data inválida, no passado, fora da janela, já existe retorno.

### Quando o retorno é cancelado sozinho

- O cliente pede para parar (opt-out) ou é bloqueado → todos os retornos são cancelados.
- A conversa passa para humano → retornos cancelados.
- Uma pessoa clica **Cancelar retorno** na fila ("O agente não voltará a falar com esta pessoa no horário combinado, e vai saber que você desmarcou").
- O agente usa `crm_cancel_followup` (quando ligado).

---

## Parte B — Fluxos de follow-up (construtor visual)

### B.1. Criar e publicar — passo a passo

1. **IA › Follow-ups › Novo fluxo.** Dê um nome (até 80 caracteres).
2. No construtor, o fluxo nasce com o nó **Gatilho**. Clique no botão do gatilho (topo) e escolha **como o fluxo começa** (§B.2).
3. **Adicionar nó** (paleta) e ligue os nós arrastando das bolinhas de saída. Cada saída tem um rótulo ("Sim", "Não", "Sem resposta", o nome de uma classe…).
4. Configure cada nó no painel lateral (§B.3).
5. Escolha a **Política de handoff** na barra de publicação (§B.5).
6. **Salvar** (rascunho; pode estar incompleto) → **Publicar** (passa pela validação, §B.6).
7. Vá ao **agente** que vai armar o fluxo › Follow-up › ligue **Habilitar gatilhos automáticos** e marque o fluxo › **Salvar rascunho** › **Publicar**.
8. Acompanhe na aba **Fila** e abra o **dossiê** de cada contato.

Ações na barra: **Salvar**, **Publicar**, **Rollback** (volta a uma versão anterior), **Desativar** (para de armar novos; os em andamento seguem a versão em que entraram).

> Cada inscrição fica **presa à versão** do grafo em que entrou. Republicar não muda quem já está no meio do caminho.

### B.2. Gatilhos — como o fluxo começa

| Tipo na tela | Quando dispara | Configuração |
|---|---|---|
| **Manual** | Só por API (`POST /api/v1/ai/followups/enrollments` com `pointer_id`, `contact_id` e opcional `agent_id`). Não passa pela exigência de agente publicado. | — |
| **Silêncio** | Varredura a cada minuto: contatos **sem mensagem recebida** há pelo menos N minutos. | **Minutos de silêncio** (5 a 10.080 = 7 dias). **Segmentos (tags, opcional)**: só contatos com alguma dessas tags (ex.: `vip, carrinho-abandonado`). Vazio = todos. |
| **Etapa do funil** | Quando um negócio **entra** numa etapa — por arrasto no quadro, por automação, em lote, por MCP **ou pelo próprio agente**. Leva poucos minutos (dois ciclos de 1 min), não é instantâneo. | **Etapa que dispara o fluxo.** A lista mostra **funil + etapa** (todo funil nasce com "Novo / Em andamento / Ganho / Perdido", então nomes se repetem — confira o funil). |
| **Agente pediu ajuda** | Quando o agente abre um **caso** para uma pessoa. E o follow-up é **cancelado sozinho** quando o caso fecha. | Sem parâmetros: vale para qualquer caso da conta. ⚠️ **Comece o fluxo por uma espera**: o agente continua conversando depois de abrir o caso — sem espera, o cliente recebe duas mensagens ao mesmo tempo. |
| **Automação (Webhooks)** | Disparado pela ação **"Iniciar fluxo de mensagem"** de uma Regra automática ([06](06-fluxos-e-automacoes.md)). | — |

Opção comum a todos: **Cancelar se o lead responder** (`cancel_on_reply`). Ligado: a primeira resposta do contato enquanto o fluxo espera resposta **encerra** o acompanhamento (desfecho "O contato respondeu"). Desligado: a resposta **acorda** o fluxo para classificar/seguir.

Existe ainda "Fim da conversa" (`conversation_end`) no contrato, mas **sem motor** — não é oferecido e a publicação recusa.

#### Regras de armação (valem para Silêncio, Etapa e Agente pediu ajuda)

- **Exige agente publicado armando:** só cria inscrição se algum agente **publicado** tiver "Habilitar gatilhos automáticos de follow-up" ligado **e** o fluxo marcado. Esse agente fica "pinado" na inscrição (persona e exibição na fila). Vários agentes → o de menor id.
- **Um follow-up vivo por contato** na organização inteira: contato já em qualquer fluxo não entra em outro. Quem concluiu ou foi cancelado pode entrar de novo na próxima varredura (silêncio) ou no próximo evento.

### B.3. Os nós (blocos)

Nomes como aparecem na paleta **Adicionar nó**. Todo nó tem também um **rótulo** livre (até 60 caracteres) que aparece no card.

| Nó | Para que serve | Configuração (limites) | Saídas |
|---|---|---|---|
| **Gatilho** | Ponto de entrada. Exatamente um por fluxo. | Nenhuma (o tipo de gatilho é do fluxo). | Sempre |
| **Aguardar** (`wait`) | Espera antes do próximo passo. Uma resposta do contato **corta** a espera e acorda o fluxo. | **Tempo fixo:** duração em minutos (mínimo 5 min, máximo 90 dias). **A IA escolhe a hora:** mínimo e máximo (min ≥ 5 min, máx ≤ 90 dias) + **Orientação (opcional, até 500)**. | Sempre |
| **Classificar (IA)** (`ai_classify`) | Espera a resposta do contato e pede à IA que a encaixe numa classe. | **Classes** separadas por vírgula (1–8, até 40 caracteres cada; ex.: `interessado, sem interesse`). **O que a IA vai ler:** Última resposta ou Resumo. **Instrução (opcional, até 500).** **Esperar a resposta por (minutos)**: mínimo 15. | Uma por classe + **Sem resposta** + Sempre |
| **Resposta (texto)** (`match_reply`) | Igual ao anterior, **sem IA**: compara o texto da resposta. Pode gravar a resposta. | Regras (1–8): **Rótulo**, operador **É igual a** / **Contém**, **texto a casar** (até 200). **Esperar a resposta por** ≥ 15 min. **Gravar resposta em:** Não gravar / Nome do contato / Campo personalizado do lead (chave livre; aceita `{{volta}}` dentro de laço). **Se a informação já existir:** Pular este passo / Perguntar de novo e substituir / Confirmar com o usuário. | Uma por regra + **Sem resposta** + Sempre |
| **Repetir** (`repeat`) | Repete um trecho N vezes, onde N vem da **última resposta** do contato ("4", "dois", "nenhum"). | **No máximo quantas voltas:** 1 a 20. | **Próxima volta** / **Acabou** / Sempre |
| **Condição** (`condition`) | Decide o caminho por dados do lead. | Regras (1–10): **Campo** — Etapa do funil, Etiqueta do contato, Passos já dados no fluxo, Desfecho do passo anterior; **Operador** — igual, diferente, ≥, ≤, contém; **Valor**. **Modo:** "Avaliar as regras juntas" (E/OU → Sim/Não) ou "Uma saída por regra" (cada regra é uma saída nomeável + "Nenhuma delas"). Trocar de modo avisa quantas ligações ficam órfãs. | Sim / Não / Sempre — ou uma por regra + Nenhuma delas |
| **Ação** (`action`) | Manda mensagem ao contato. | **Texto fixo** (até 4.000; sai exatamente assim, sem IA; no laço `{{volta}}`/`{{voltas}}` viram o número da volta). **Mensagem escrita pela IA**: **Instrução para a IA** (até 1.000) + **Se a IA não conseguir escrever, mandar este modelo** (opcional). **Modelo de mensagem pronto**: escolhe de Ajustes › Modelos. | Sempre |
| **Fim** (`end`) | Encerra o acompanhamento. | **Resultado:** Convertido / Esgotado / Personalizado. **Nota (opcional, até 200).** | — |

Mensagens do fluxo passam pela **mesma cadeia de conferências** do agente (opt-out, LGPD, ritmo, janela de 24h, etc.). A "Mensagem escrita pela IA" é escrita pelo agente pinado na inscrição, com a persona dele.

#### "A IA escolhe a hora" (plano de tempo)

Quando o fluxo começa, **uma** chamada de IA planeja **todas** as esperas adaptativas do fluxo de uma vez (é estratégia, não reflexo). Para cada uma, a IA propõe um instante e uma frase curta explicando. Se propuser fora do intervalo mínimo–máximo, o valor é **grampeado** e o dossiê mostra "a IA pediu 3 dias, seu limite era 12h". Se o plano vier ilegível, todas as esperas usam o **máximo**.

### B.4. Arestas

Cada ligação sai de uma **saída** de um nó. Clicar numa aresta abre **"Quando seguir por esta aresta"**, listando as saídas do nó de origem (as mesmas do card). **Sempre** é a saída de reserva (exatamente uma por nó). As saídas têm id estável: renomear uma classe/regra não solta a ligação.

### B.5. Política de handoff

O que acontece com o acompanhamento quando a conversa **passa para humano**:

| Opção | Efeito |
|---|---|
| **Pausar durante handoff** | Fica "Pausado — um humano assumiu" e **retoma** quando a conversa volta ao agente. |
| **Cancelar durante handoff** | Encerra (desfecho "Passou para um humano"). |
| **Permitir durante handoff** | Segue andando. ⚠️ Mesmo assim, o envio é barrado enquanto o cliente estiver marcado como "forçar humano". |

### B.6. Validação ao publicar

Salvar aceita rascunho incompleto; **publicar** exige:

| Código | Significa |
|---|---|
| `no_trigger` / `multiple_triggers` | Precisa de exatamente um Gatilho. |
| `unreachable_node` | Nó que nenhum caminho alcança. |
| `no_end_path` | Caminho que nunca chega a um Fim. |
| `missing_always_fallback` | Nó sem a saída de reserva "Sempre" ligada. |
| `missing_branch_edge` / `missing_class_edge` / `missing_no_reply_edge` | Saída (regra, classe, "Sem resposta") sem ligação. |
| `grace_too_short` | Espera pela resposta abaixo de 15 min. |
| `cycle_without_wait` | Laço sem uma espera de pelo menos 5 min. |
| `max_steps_exceeded` | Caminho mais longo passa de 30 passos. |
| `long_wait_needs_template` | "Mensagem escrita pela IA" depois de ≥ 24 h acumuladas de espera **sem modelo de reserva** — fora da janela de 24h do WhatsApp oficial só sai modelo aprovado. |
| Gatilho de etapa sem etapa | Recusado (o fluxo ficaria ativo sem nunca disparar). |

Limites do grafo: 2 a 60 nós, até 120 arestas.

---

## Parte C — Reatividade: o fluxo reage ao contato

Um consumidor de eventos (independente do motor do fluxo) aplica:

| Evento | Reação |
|---|---|
| Mensagem recebida de contato **bloqueado** (STOP) | Cancela **tudo** do contato (desfecho "Pediu para parar"). |
| Mensagem recebida, fluxo **aguardando resposta** | Com "Cancelar se o lead responder": cancela ("O contato respondeu"). Sem: **acorda** o nó para classificar/comparar. |
| Mensagem recebida, fluxo num **Aguardar** | Corta a espera e segue. |
| Conversa **passou para humano** | Aplica a política de handoff (pausar/cancelar/permitir). |
| Conversa **voltou ao agente** | Retoma os pausados. |
| Caso **fechado** (gatilho "Agente pediu ajuda") | Cancela o follow-up nascido daquele caso. |

---

## Parte D — Fila, dossiê e intervenção humana

**Aba Fila:** inscrições ativas e retornos agendados pela IA. Filtros por fluxo e status, busca por contato. Colunas: Contato, Fluxo/Promessa, Nó atual/Motivo, Próximo disparo, Status.

**Dossiê** (clicar numa linha): a caminhada do contato no fluxo, eventos legíveis, o plano de tempo escolhido pela IA e as ações:

| Ação | Efeito |
|---|---|
| **Pausar** | "Parado até alguém retomar". Não é a pausa de handoff — só uma pessoa retoma. |
| **Retomar** | Volta a andar. |
| **Adiar o próximo passo** | Empurra o próximo disparo (até 90 dias). |
| **Pular este passo** | Avança para o próximo nó. |
| **Cancelar follow-up** | Encerra. Não pode ser desfeito. |

Se o motor estiver processando a inscrição no instante do clique, a ação é recusada com o motivo (409) — nunca sobrescreve em silêncio.

### Situações e desfechos

| Situação | Significa |
|---|---|
| Em andamento | Andando no fluxo |
| Aguardando resposta | Parado num nó de classificar/comparar |
| Pausado — um humano assumiu | Política de handoff = pausar |
| Concluído | Chegou a um Fim |
| Cancelado | Cancelado por pessoa, resposta, opt-out ou caso fechado |
| Parou por falha | Esgotou tentativas — abre aviso "Um fluxo de follow-up parou de tentar" na Central |

| Desfecho | Quando |
|---|---|
| Convertido / Esgotado | Fim escolhido no nó |
| O contato respondeu | Cancelou por resposta |
| Pediu para parar | Opt-out |
| Passou para um humano | Política de handoff = cancelar |

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Contrato do grafo | `lib/followup/graph-schema.ts` |
| Gatilhos | `lib/followup/api-schemas.ts`, `silence-sweep.ts`, `gatilho-etapa.ts`, `gatilho-caso.ts` |
| Exigência de agente publicado | `lib/followup/agent-followup-gate.ts` |
| Motor (tick 1×/min) | `lib/followup/engine.ts`, `node-handlers.ts`, cron `app/api/v1/cron/followup-flow-worker` |
| Ponte com o agente | `lib/followup/turn-bridge.ts`, `lib/agent-engine/agent/followup-turn.ts` |
| Reatividade | `lib/followup/reactivity.ts` (consumidor do `event_log`) |
| Plano de tempo | `lib/followup/timing-plan.ts`, `plano-de-tempo.ts` |
| Intervenção | `lib/followup/intervencao.ts` |
| Retorno agendado | `lib/followup/retorno.ts`, `lib/agent-engine/agent/schedule-followup.ts` |
| Vocabulário da tela | `lib/followup/vocabulario.ts` |

Tabelas: `followup_flow_pointers` (o fluxo editável: `draft_graph`, `trigger_config`, `handoff_policy`, `status`), versões imutáveis, `followup_enrollments` (uma inscrição; índice único de "um vivo por contato"), `followup_enrollment_events` (passo a passo), `cron_jobs` (retornos).

API: `/api/v1/ai/followup-flows` (+ `/:id`, `/publish`, `/rollback`, `/disable`), `/api/v1/ai/followups/enrollments` (+ `/:id/pause|resume|skip|snooze|cancel`), `/api/v1/ai/followups/promises` (+ `/:id/cancel`), `/api/v1/ai/followups/queue`.
