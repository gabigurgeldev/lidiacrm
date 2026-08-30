# Flow Engine — arquitetura

> O motor de automação por grafo com registry de nós. Fase 1.

## Por que um terceiro motor

O repositório já tinha dois, e nenhum dos dois admitia um **tipo de nó novo**
sem edição espalhada:

| Motor | Relógio | O que faz | O teto |
|---|---|---|---|
| `lib/automation` | o evento do `event_log` | regra linear: gatilho, condições em AND, ações em série | não tem grafo, não tem espera |
| `lib/followup` | `followup_enrollments.next_eval_at` | grafo com espera, classificação por IA, loop | os 8 tipos de nó são uma **união Zod fechada** |
| `lib/flow-engine` | `flow_executions.next_eval_at` | grafo com **registry** de nós | um cursor por execução (fase 1) |

Decisão do dono do produto em 2026-08-30. Os dois motores anteriores seguem
intactos e em produção; nada nesta fase os toca.

**O custo, dito na cara:** claim, retry, backoff e dead-letter foram
reescritos, e os do follow-up já estavam verdes sob invariante no CI. O
contrapeso é o registry — dentro de uma união fechada ele seria uma reforma
maior que um começo limpo.

## O caminho de um lead

```
crm_leads (INSERT)
   │  trigger Postgres fn_emit_event_on_lead_change
   ▼
event_log  ·  event_type = 'lead.created'
   │  cron event-log-drain  →  lib/event-log/dispatcher
   ▼
flowTriggerHandler          (lib/flow-engine/trigger-matcher.ts)
   │  acha os fluxos ATIVOS cuja versão publicada tem esse gatilho
   ▼
flow_executions  ·  status='pending', next_eval_at=agora
   │  cron flow-engine-worker  (1×/min)
   ▼
fn_claim_due_flow_executions  ·  rodízio por org, FOR UPDATE SKIP LOCKED
   │
   ▼
rodarTickDeFluxos           (lib/flow-engine/engine.ts)
   │  carrega o grafo FIXADO na versão, monta o contexto
   ▼
FlowNodeDefinition.execute  ·  puro, sem Supabase
   │  advance / wait / complete / fail / dead
   ▼
flow_execution_events       ·  append-only, chave de idempotência
```

## Quem depende de quem

`lib/flow-engine/` não importa nada do `lib/followup`, e vice-versa. O que ele
**reusa** de fora, e por quê:

| Peça | De onde | Por que não reescrever |
|---|---|---|
| `sendMessageHandler` | `app/api/v1/messages/_handler.ts` | um envio paralelo pularia a cadeia `before_send` de 10 gates — opt-out, LGPD, pacing anti-banimento, janela de 24h. É a única mudança aqui capaz de fazer o número do cliente ser banido |
| `desfechoDoEnvio` | `lib/automation/desfecho-do-envio.ts` | guarda a lição de que sucesso vem do ESTADO da mensagem, nunca da ausência de exceção |
| `ensureConversation`, `sessaoProntaParaEnvio` | `lib/automation/start-conversation.ts` | já tratam reabertura de conversa fechada e a corrida do `23505` |
| `selectRoundRobin` | `lib/routing/decide.ts` | puro e já testado; duas implementações de rodízio divergiriam na primeira mudança de regra |
| `loadEligibleAttendants` | `lib/routing/eligibles.ts` | disponibilidade, horário e capacidade num lugar só |
| `event_log` + drain | `lib/event-log/` | já é o barramento; um segundo seria evento sem consumer duplicado |

## As quatro tabelas

Migration `0203`. Racional completo no cabeçalho dela.

- **`flows`** — o ponteiro MUTÁVEL: o que o operador edita.
- **`flow_versions`** — o grafo IMUTÁVEL publicado. Carrega uma cópia do
  gatilho: o ponteiro pode mudar amanhã, e a execução em voo precisa continuar
  sabendo sob qual condição foi armada.
- **`flow_executions`** — uma execução, com UM cursor.
- **`flow_execution_events`** — o passo a passo, append-only.

Não há tabela de dead-letter: `status='dead'` **é** a fila de erro, e a tela de
Erros é uma consulta.

## O que ainda não existe

Declarado, não escondido. Nada disto aparece na tela como botão morto.

| Fora | Por quê |
|---|---|
| Paralelo, JOIN, subfluxo | um cursor por execução; N ramos pedem migration e reescrita do tick |
| Parser de expressão (`{{ lead.value * 0.1 }}`) | superfície de ataque; os operadores estruturados cobrem a fase inteira |
| **Nó de código (JS em sandbox)** | ⚠️ o worker roda com a `SUPABASE_SERVICE_ROLE_KEY`, que ignora toda RLS. `node:vm` não é fronteira de segurança, e um escape lê o banco de todos os tenants. Só entra com isolamento de processo real |
| Meta Cloud: CRUD de template, SMART SEND | preparado (o nó lê `capabilitiesOf`), não ligado |
| Analytics de caminho, custo, A/B, cofre de credenciais | fases seguintes |
