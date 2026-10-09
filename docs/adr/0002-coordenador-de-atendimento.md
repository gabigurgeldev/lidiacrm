# ADR-0002 — Coordenador de atendimento

- **Status:** aceito; implementação por marcos (M1 = núcleo persistido)
- **Data:** 2026-10-09
- **Contexto medido em:** `54c4050a` (`main`)
- **Pedido de origem:** Prompt de implementação do coordenador de atendimento (09/10/2026)

## Contexto: o que acontece hoje com uma mensagem do cliente

Medido por leitura do código na referência acima.

Depois de `pos-entrada.ts` gravar a mensagem, aplicar o opt-out e abrir a
demanda, **até cinco consumidores** reagem à mesma mensagem, sem árbitro entre
eles:

| Consumidor | Onde | O que faz |
|---|---|---|
| Gatilhos de fluxo | `lib/flow-engine/trigger-matcher.ts` (`armarFluxosParaEvento`) | Arma **todo** fluxo ativo cujo gatilho casa; N fluxos geram N execuções. |
| Frentes esperando | `lib/flow-engine/acordar-por-evento.ts` | Acorda **toda** frente esperando `message.received`; o casamento é só por `contact_id`, atravessando fluxos e conversas. |
| Follow-up | `lib/followup/reactivity.ts`, `aplicar-inbound.ts` | Cancela ou avança enrollments; `aplicarTextoNosFollowups` roda sem o lease do tick. |
| Automações | `lib/automation/engine.ts` | Roda todas as regras; duas ações falam com o cliente. |
| Turno do agente | `edge/crm/drain.ts` → `inbound-turn.ts` | Debounce de 8 s, depois resolve o agente. O roteador (`ai_routers`) **reclassifica** mesmo com agente fixado. |

"Quem conduz" não tem dono: cada caminho deduz a resposta de um subconjunto
diferente de seis lugares:

- `contacts.force_human`;
- `conversations.bot_silenced_until`, `assignee_kind` e `active_ai_agent_id`;
- `flow_executions.silencia_ia`;
- `settings.ai_dispatch_mode`.

O mais próximo de um read-model é `comandoDaConversa`, que não enxerga fluxo
nem agente fixado.

O subfluxo (`flow.call`) está quebrado de três formas, o que impede usar a
chamada com retorno que já existe:

- `chamarSubFluxo` lê `flows.published_version_id`, coluna que não existe; a
  coluna real é `active_version_id`;
- ao acordar, chama o filho de novo;
- `output` nunca é gravado.

Além disso, morte ou falha do filho não avisa o pai, e cancelar não cascateia.

## Decisões

### 1. Um serviço de transições, autoridade no banco

Toda mudança de responsável passa por `fn_coord_transicionar`.

- **Na mesma transação:** lock curto de linha, CAS em `versao`, regra de
  prioridade humana, `geracao+1`, diário e outbox (o `event_log` que inicia o
  próximo executor).
- **Fora da transação:** o decisor (LLM). O fluxo é ler o snapshot, decidir e
  então aplicar. Uma versão divergente significa que alguém transicionou no
  meio, e o resultado é descartado e registrado como `obsoleta`.

A autoridade única é regra de banco, não serviço separado. Ela roda no mesmo
worker e nas mesmas rotas.

### 2. Fencing por geração, checado colado ao envio

Cada troca de responsável incrementa `geracao`. O executor carrega a geração
com que foi despachado, e `fn_coord_pode_falar` recusa:

- geração velha;
- executor que não é o dono;
- conversa com pessoa no comando ou bloqueada.

**Ponto de linearização:** a checagem acontece no envio canônico
(`sendMessageHandler`), antes do INSERT da mensagem. Ela se repete:

- no `runBeforeSend`, sob o advisory lock do canal;
- no reenvio de `queued`.

**Limite declarado:** um pedido que já atravessou para o provedor (WAHA/Meta)
antes da troca pode chegar ao cliente. O que se impede são novos envios
obsoletos e reenvios. Não há exactly-once no transporte externo.

### 3. Prioridade humana por trigger, não por chamador

Triggers em `conversations` (`assignee_kind='user'`,
`bot_silenced_until='infinity'`, `status='claimed'`) e em `contacts`
(`force_human`, `is_blocked`) levam o estado a `pessoa` ou `bloqueado` e
incrementam a geração.

Assim todo caminho humano que já existe invalida os executores automáticos,
sem caçar chamador por chamador:

- rotas de claim e pausa;
- MCP;
- handoff do agente;
- `fn_conversation_assign`;
- SQL direto.

Os triggers só atualizam linha; nunca fazem HTTP. Só uma transição de
categoria `manual` tira a conversa de `pessoa`; regra, modelo e retorno
atrasado são recusados.

### 4. Escopo: só conversas que o coordenador conduz

Sem política publicada (ou com modo `off`) nenhuma linha de estado nasce, e
`fn_coord_pode_falar` responde `sem_coordenacao` com `pode=true`. O legado
decide exatamente como antes. Esse é o rollout seguro: o código entra na
`main` desligado.

### 5. Política: completa por número, sem mescla

A precedência é esta:

- a política do número, se existir, vale **inteira**;
- senão vale a da organização.

Não há mescla campo a campo. Um merge de destinos de duas versões tornaria
impossível responder "qual versão decidiu isto?", que é o que o diário precisa
dizer. A tela apresenta a do número como "este número segue regras próprias".

Os destinos são FK para `ai_agents` e `flows`, filhos imutáveis da versão. Um
destino em rascunho existe na política e não recebe conversa até ser publicado.

### 6. Decisor: OpenRouter, pelo seam que já existe

O decisor é uma finalidade nova (`coordenador_decidir`) no registro de pontos
de IA, resolvida por `runModelCall`. Com isso herda sem código novo:

- a escolha de modelo pelo usuário (OpenRouter) no painel de provedores;
- o orçamento;
- timeout;
- telemetria em `llm_calls`.

A saída é validada, e a escolha precisa estar entre os elegíveis do
pré-filtro.

O contrato de decisão (`lib/coordenador/decisor/contrato.ts`) é neutro de
fornecedor:

- escolha;
- manter;
- pedir esclarecimento;
- confiança quando o provedor fornecer;
- status de falha.

**Divergência autorizada do pedido de origem.** O pedido previa um adaptador
nativo da Decisions API da OpenAI e preparação para Jev. O dono do produto
decidiu (09/10/2026) que a decisão sai pelo OpenRouter, com o modelo que o
usuário escolher. Por isso:

- não há adaptador da Decisions API nem do Jev;
- não há tela dizendo "conectado" a nenhum dos dois;
- o contrato permite acrescentá-los depois sem refatoração.

Confiança autorrelatada por LLM **não** é tratada como probabilidade
calibrada. Abaixo de `confianca_minima`, ou sem confiança, a regra é:

- manter o responsável atual, se for elegível;
- senão aplicar o destino padrão;
- e registrar a transição com categoria `fallback`.

### 7. Chamada com retorno e transferência definitiva são coisas diferentes

`coord_chamadas.modalidade` (`retorno` | `definitiva`) é a fonte de verdade.

- **Retorno:** guarda a origem exata (agente e versão, ou
  execução/frente/nó), a geração da origem, o prazo e o output esperado. Ao
  concluir, a origem é retomada se a chamada ainda for válida. Se uma pessoa
  assumiu no meio, a origem não é retomada.
- **Definitiva:** encerra a continuação, e um *completion* antigo não volta.

Retorno esperado não conta como transferência no limite de laço
(`lib/coordenador/limites.ts`).

### 8. O que NÃO muda

- `crm.handoff_to_agent` mantém o poder legado de devolver um atendimento que
  uma pessoa assumiu. Delegação nova entre fluxo e agente **não** herda esse
  poder.
- `start_message_flow` continua sendo inscrição de follow-up.
- `request_human_handoff` continua sendo o único jeito de o agente pedir
  humano.
- `crm_leads.owner_user_id` é dono **comercial** e não representa agente nem
  fluxo.

## Limites (defaults e razão)

| Limite | Default | Razão |
|---|---|---|
| Transferências por janela | 4 em 30 min | O caso legítimo mais longo do pedido (entrada → agente → fluxo → retorno → outro agente) usa 3 transferências fora de retorno. |
| Profundidade de chamada | 3 | Agente → fluxo → agente-tarefa → fluxo já é mais aninhamento do que qualquer cenário do pedido. |
| Prazo de chamada | 24 h | Igual ao `PRAZO_DO_SUBFLUXO_MS` do motor: a tarefa espera o cliente do mesmo jeito. |
| Chamadas do decisor | 20/h por conversa | Teto de custo. Acima disso a conversa está em laço, e o modelo não é a solução. |
| Timeout do decisor | 8 s | Igual ao debounce de entrada: decidir não pode custar mais do que a espera que já existe. |
| Candidatos | 12 | Pré-filtro determinístico antes do modelo. Lista maior degrada a escolha e o custo. |

Todos são configuráveis por política (`limitesSchema`) e serão recalibrados com
o corpus do marco M7.

## Marcos

- **M1:** núcleo persistido.
- **M2:** entrada e primeira escolha.
- **M3:** ciclos agente↔fluxo e envio com fencing.
- **M4:** automações, follow-up, manual, legado, reconciliação e watchdog.
- **M5:** telas.
- **M6:** criador de agente cria o coordenador.
- **M7:** medição.
- **M8:** empacotamento.

Cada marco entra na `main` com o coordenador desligado por padrão.
