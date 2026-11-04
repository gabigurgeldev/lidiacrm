# Integração com o Back Office de afiliados da Gestalt

O Back Office (sistema central de afiliados e comissões da Gestalt) cria contas neste CRM sem
ninguém entrar no painel de plataforma. Tenant = organização.

## Ligar

1. No Back Office: **Produtos → Gestalt CRM → Integração**, gere o **segredo de saída** e preencha a
   **URL base da API** com a URL pública do CRM (`NEXT_PUBLIC_APP_URL`, sem `/api`).
2. No CRM: `BACKOFFICE_OUTBOUND_SECRET=<segredo>` no `.env` e reinicie o `app`.
3. No Back Office, **Testar conexão** deve responder `{ "ok": true }`.

Sem o segredo as rotas respondem `503 backoffice_not_configured`.

## Rotas (`/backoffice/*`, fora da sessão; auth por HMAC)

Toda chamada traz `X-Timestamp` (unix, ±5 min) e
`X-Backoffice-Signature: sha256=<hex de HMAC-SHA256("{timestamp}.{corpo}", segredo)>`.
As respostas são JSON cru (sem o envelope `{ data }` da `/api/v1`): o contrato é do Back Office.

| Rota | O que faz |
| --- | --- |
| `GET /backoffice/health` | `{ ok: true, version }` |
| `GET /backoffice/stats` | `{ users_total, users_active, customers_paying }` das organizações do Back Office |
| `GET /backoffice/subscriptions?updated_since=ISO` | Conciliação; `next_cursor` = `updated_at` do último item |
| `POST /backoffice/tenants` | Cria a organização e convida o dono como `admin` |
| `POST /backoffice/tenants/{id}/suspend` | `organizations.status = suspended` |
| `POST /backoffice/tenants/{id}/reactivate` | Volta para `active` |
| `PATCH /backoffice/tenants/{id}` | `{ plan, amount_cents }` — plano cobrado pelo CRM; o valor novo vale enquanto a assinatura ainda não foi ao Asaas |
| `POST /backoffice/billing/sync` | `{ cursor? }` → reenvia o histórico de cobrança pela fila de eventos; responde `{ invoices, subscriptions, enqueued, sent, next_cursor }` (ver "Sincronizar o histórico" abaixo) |

`POST /backoffice/tenants` recebe
`{ request_id, company_name, document, owner: { name, email, whatsapp }, plan, amount_cents, affiliate_code?, extra }`
e responde `{ external_tenant_id, access_url }`:

- **Idempotente por `request_id`** (UNIQUE em `backoffice_tenants`): repetir o pedido devolve a mesma
  organização, com um link novo e sem reenviar e-mail.
- `access_url` é o convite `admin` do dono (`/team/accept-invite/<token>`), válido por **7 dias**. Serve a
  quem já tem conta e a quem ainda não tem. Também vai por e-mail quando o Resend está configurado; sem
  ele, o admin da Gestalt manda o link pelo WhatsApp.
- `external_tenant_id` é o `organizations.id`. O Back Office grava o cliente com esse ID e o vincula
  ao afiliado informado; por isso o CRM **não** envia `customer.created` para essas organizações.
- Suspender/reativar/plano só alcançam organizações com linha em `backoffice_tenants` — organização
  criada por signup ou pelo painel de plataforma responde 404.
- Suspender e reativar emitem `tenant.suspended` / `tenant.reactivated` no `event_log`, como o painel
  de plataforma, e ficam no `api_audit_log`.

## Caminho de volta: cadastro indicado, pagamentos e comissão (CRM → Back Office)

Liga com `BACKOFFICE_URL` (URL do Back Office, sem `/api`) + `BACKOFFICE_API_KEY` (chave do produto,
**Produtos → Gestalt CRM → Integração → Gerar chave**). Qualquer uma vazia = nada sai do CRM.
Código em `lib/backoffice/saida.ts`; tabelas `backoffice_indicacoes` e `backoffice_saida` (migration 0221).

1. **Link do afiliado.** No Back Office o produto fica **aberto**, com URL de cadastro
   `https://<crm>/signup`. O link `/r/CODIGO/gestalt-crm` cai em `/signup?ref=CODIGO`; a tela pergunta
   ao Back Office (`GET /api/v1/affiliates/validate`) e mostra o desconto. O código fica num cookie
   `bo_ref` por 90 dias e também pode ser digitado ("Tenho um código de indicação").
2. **Desconto.** Ao criar a organização o código é conferido de novo e o desconto do afiliado vira
   `assinaturas.valor_centavos` (ex.: 50% de R$ 1.200 = R$ 600). A assinatura do Asaas nasce com esse
   valor, então toda renovação já sai descontada.
3. **Eventos** (`POST /api/v1/events`, `Authorization: Bearer <chave>`, `X-Timestamp`,
   `X-Signature: sha256=HMAC(chave, "{ts}.{corpo}")`). Cliente = organização (`customer.external_id` =
   `organizations.id`), com `affiliate_code` quando houver indicação e `customer.phone` (WhatsApp do
   dono, só dígitos, de `user_metadata.phone` do cadastro) quando houver — organização criada pelo
   Back Office não tem dono no `created_by`, e lá o Back Office já tem o WhatsApp:

   | Quando | Evento | `event_id` |
   | --- | --- | --- |
   | Organização criada pelo cadastro | `customer.created` | `crm_org_<orgId>_created` |
   | Cobrança do Asaas paga (`CONFIRMED`/`RECEIVED`) | `payment.succeeded` | `crm_pay_<paymentId>_succeeded` |
   | Cobrança estornada (`REFUNDED`, total) | `payment.refunded` | `crm_pay_<paymentId>_refunded` |
   | Chargeback | `payment.chargeback` | `crm_pay_<paymentId>_chargeback` |
   | Assinatura cancelada | `subscription.canceled` | `crm_sub_<subId>_canceled` |
   | Cobrança em aberto (`PENDING`) | `invoice.updated` `pending` | `crm_pay_<paymentId>_pending_<vencimento>` |
   | Cobrança vencida (`OVERDUE`) | `invoice.updated` `overdue` | `crm_pay_<paymentId>_overdue_<vencimento>` |
   | Cobrança paga (`CONFIRMED`/`RECEIVED`/`RECEIVED_IN_CASH`) | `invoice.updated` `paid` | `crm_pay_<paymentId>_paid` |
   | Cobrança excluída (`DELETED`) | `invoice.updated` `canceled` | `crm_pay_<paymentId>_canceled` |
   | Assinatura aberta, status mudou, teste estendido | `subscription.updated` | `crm_org_<orgId>_sub_<status>_<data>` |

   `invoice` = `{ external_id, amount_cents, due_date, payment_url, status, method, paid_at? }`, com
   `external_id` = id da cobrança no Asaas — o **mesmo** `payment.external_id` do `payment.succeeded`,
   que é como o Back Office baixa a fatura espelhada. `payment_url` é a `invoiceUrl` do Asaas (só
   `https`). O vencimento entra no `event_id` de pendente/vencida porque o Asaas pode mudar a data de
   uma cobrança em aberto. A fatura paga vai além do `payment.succeeded` para que um `pending`
   atrasado na fila nunca reabra, no Back Office, uma fatura já paga. Só em `paid` vai `paid_at`
   (ISO-8601 com fuso): o **mesmo** instante do `payment.succeeded` — hora real se o pagamento é de
   hoje, 15:00Z (meio da tarde em São Paulo) se é de outro dia.

   `subscription` = `{ status, trial_ends_at, subscribe_url, amount_cents, external_id? }`. Status no
   vocabulário do Back Office: `trial`→`trial`, `ativa`→`active`, `inadimplente`→`past_due`,
   `cancelada`→`canceled`. `trial_ends_at` é o dia (São Paulo) de `trial_termina_em`, só em `trial`
   (fora dele vai `null`); `subscribe_url` = `NEXT_PUBLIC_APP_URL/assinatura` quando é `https`. O
   `<data>` do `event_id` é o fim do teste (`trial`), o `pago_ate` (`active`/`past_due`, ou
   `nunca_pagou`) ou o dia do cancelamento. Organização isenta não manda.

   Todo caminho que grava cobrança (webhook, checkout, conciliação horária) passa por
   `gravarCobranca`, que enfileira; o `event_id` estável faz a repetição não contar. O envio sai logo
   depois da resposta; o cron `backoffice-saida` (5 min) reenvia o que falhou (1, 2, 4… min, até 1 h
   entre tentativas, por até 7 dias). 200/409 = entregue; outro 4xx = `falhou` com o erro gravado.

4. **Aviso de cobrança ao cliente** (fatura pendente/vencida, fim do teste grátis) é do **Back Office**,
   pelo WhatsApp, a partir dos eventos acima — com a chave **Avisos de cobrança pelo Back Office** ligada
   no produto, lá. O Back Office manda à fatura de cartão só o aviso de vencida.

   Para o cliente não receber o mesmo aviso duas vezes, **o Asaas é calado** (`notificationDisabled: true`)
   enquanto `BACKOFFICE_URL` + `BACKOFFICE_API_KEY` estiverem preenchidos: cliente criado ou atualizado no
   checkout já nasce assim (`lib/billing/asaas.ts`). Sem o Back Office o Asaas continua avisando — calá-lo
   sem ninguém no lugar deixaria o cliente sem aviso. Os clientes do Asaas que já existiam são acertados
   uma vez, depois de ligar a chave no Back Office:

   ```bash
   pnpm tsx --env-file=<.env da instalação> scripts/asaas-desligar-notificacoes.ts            # simulação
   pnpm tsx --env-file=<.env da instalação> scripts/asaas-desligar-notificacoes.ts --aplicar  # de verdade
   ```

   A conciliação horária (`billing-conciliar`) é a rede: cada cobrança que ela confere passa por
   `gravarCobranca` (que enfileira o `invoice.updated`), e todo teste grátis em andamento que ainda não
   foi ao Back Office entra na fila com a data de fim — inclusive os que começaram antes disto. O resumo
   do cron traz `testes_avisados`.

5. **Sincronizar o histórico** (`POST /backoffice/billing/sync`, assinada como as outras rotas
   `/backoffice/*`). O botão de `/admin/cobrancas` do Back Office chama em laço, com o `next_cursor`
   da resposta anterior, até ele vir `null` (60 s por chamada). Corpo `{ cursor?: string | null }`
   — e só isso: a organização de cada evento vem da linha do banco, nunca do corpo.

   - Cada chamada lê **200** linhas de `cobrancas` em ordem de `(created_at, id)` e manda cada uma
     como `invoice.updated`, com `event_id` `crm_sync_<paymentId>_<estado>` (mesma regra de estado e
     de vencimento da tabela acima; `paid_at` a partir de `pago_em`). Página curta = fim das
     cobranças: a mesma chamada manda as primeiras 200 `assinaturas` (não isentas) como
     `subscription.updated` `crm_sync_org_<orgId>_sub_<status>_<data>`; se houver mais, o cursor
     segue por elas. `next_cursor` é opaco (base64url); cursor que o CRM não emitiu = `422 invalid_cursor`.
   - **Nunca `payment.succeeded`**: no Back Office ele gera comissão, e pagamento antigo reenviado
     viraria comissão nova.
   - O prefixo `crm_sync_` existe porque o `crm_pay_…` de uma fatura antiga já está na fila
     (enviado ou `falhou`) e o UNIQUE engoliria o reenvio. Ele é estável: chamar de novo não duplica
     nada — e evento `crm_sync_` que já foi (ou que ficou `falhou`) **não** volta a ir.
   - Resposta `{ invoices, subscriptions, enqueued, sent, next_cursor }`: eventos montados nesta
     página, quantos entraram agora na fila, e quantos o Back Office aceitou **nesta chamada**. O
     envio para em ~40 s; o que não coube fica `pendente` e o cron `backoffice-saida` manda em até
     5 min — por isso `sent` pode ser menor que `enqueued`.
   - Sem `BACKOFFICE_URL`/`BACKOFFICE_API_KEY` responde `503 backoffice_outbound_not_configured`;
     erro de banco no meio = `500 sync_failed` (repetir o mesmo cursor é seguro). Chamada que
     enfileirou ou entregou algo fica no audit como `backoffice.sincronizacao_run` (só contagens).

Estorno parcial (`PAYMENT_PARTIALLY_REFUNDED`) não é enviado: o Asaas não informa o total estornado no
evento. Faça o ajuste pelo Back Office (lançamento manual) se acontecer.

Para ver a fila:

```sql
select status, count(*) from backoffice_saida group by 1;
select event_id, tentativas, ultimo_erro from backoffice_saida where status <> 'enviado' order by created_at desc limit 20;
```

## Testar

```bash
pnpm vitest run lib/backoffice
pnpm test:db   # inclui tests/invariants/backoffice-indicacao-rls.test.ts
```
