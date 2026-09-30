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
| `PATCH /backoffice/tenants/{id}` | `{ plan, amount_cents }` — plano cobrado pela Gestalt |

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
   `organizations.id`), com `affiliate_code` quando houver indicação:

   | Quando | Evento | `event_id` |
   | --- | --- | --- |
   | Organização criada pelo cadastro | `customer.created` | `crm_org_<orgId>_created` |
   | Cobrança do Asaas paga (`CONFIRMED`/`RECEIVED`) | `payment.succeeded` | `crm_pay_<paymentId>_succeeded` |
   | Cobrança estornada (`REFUNDED`, total) | `payment.refunded` | `crm_pay_<paymentId>_refunded` |
   | Chargeback | `payment.chargeback` | `crm_pay_<paymentId>_chargeback` |
   | Assinatura cancelada | `subscription.canceled` | `crm_sub_<subId>_canceled` |

   Todo caminho que grava cobrança (webhook, checkout, conciliação horária) passa por
   `gravarCobranca`, que enfileira; o `event_id` estável faz a repetição não contar. O envio sai logo
   depois da resposta; o cron `backoffice-saida` (5 min) reenvia o que falhou (1, 2, 4… min, até 1 h
   entre tentativas, por até 7 dias). 200/409 = entregue; outro 4xx = `falhou` com o erro gravado.

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
