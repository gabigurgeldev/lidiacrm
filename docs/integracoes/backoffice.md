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
  ao afiliado informado; por isso o CRM **não** envia `customer.created`.
- Suspender/reativar/plano só alcançam organizações com linha em `backoffice_tenants` — organização
  criada por signup ou pelo painel de plataforma responde 404.
- Suspender e reativar emitem `tenant.suspended` / `tenant.reactivated` no `event_log`, como o painel
  de plataforma, e ficam no `api_audit_log`.

## Testar

```bash
pnpm vitest run lib/backoffice
```
