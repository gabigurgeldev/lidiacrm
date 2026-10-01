# Cobrança da assinatura pelo Asaas

O CRM cobra uma mensalidade por organização, com teste grátis no cadastro.
O pagamento é feito dentro do sistema, por PIX ou cartão de crédito, e o Asaas
processa. Este documento é o passo a passo para ligar a cobrança e o que
esperar dela.

## Regras

| Situação | Acesso |
|---|---|
| Cadastro novo | teste grátis de `COBRANCA_DIAS_TRIAL` dias (padrão 7), sem cartão |
| Fim do teste sem assinar | **bloqueado** no mesmo instante (sem tolerância) |
| Mensalidade paga | liberado até o mesmo dia do mês seguinte ao vencimento |
| Mensalidade vencida | liberado por mais `COBRANCA_DIAS_TOLERANCIA` dias (padrão 3), com aviso; depois **bloqueado** |
| Pagou (PIX ou cartão) | liberado **na hora** — o webhook do Asaas grava o pagamento |
| Cancelou | liberado até o fim do período pago; depois bloqueado (sem tolerância) |
| Isenta (chave no painel `/admin`) | nunca paga, nunca bloqueia |

"Bloqueado" significa: a tela do CRM vira a tela de pagamento (`/assinatura`),
a API responde `402 payment_required`, e as automações param (agente de IA,
follow-ups, fluxos, disparos, regras automáticas). **Mensagens recebidas
continuam sendo gravadas** — nada do cliente se perde; ao pagar, tudo volta.

Organizações que já existiam quando a cobrança entrou ficaram **isentas**
(migration 0217). Organizações criadas pelo Back Office de afiliados
(`POST /backoffice/tenants`) nascem em **teste**, como as do `/signup`, com o
valor do plano que o Back Office mandou — e são cobradas pelo CRM.

A regra inteira está em `lib/billing/acesso.ts` e é calculada das datas: não há
cron que bloqueia — a data passa e o bloqueio acontece.

## Ligar

1. **Chave de API.** No Asaas: *Minha conta › Integrações › Gerar chave*.
   Comece pelo **sandbox** (`https://sandbox.asaas.com`).
2. **Webhook.** No Asaas: *Minha conta › Integrações › Webhooks › Adicionar*.
   - URL: `https://SEU-DOMINIO/api/v1/webhooks/asaas`
   - Versão da API: v3
   - Token de autenticação: um segredo longo gerado por você (ex.: `openssl rand -hex 32`)
   - Eventos: todos de **Cobranças** (`PAYMENT_*`) e de **Assinaturas** (`SUBSCRIPTION_*`)
   - Fila de sincronização ativada
3. **`.env` da VPS:**

   ```env
   ASAAS_API_KEY=aact_...             # chave do passo 1, SEM o "$" inicial
   ASAAS_AMBIENTE=sandbox             # rótulo; quem decide é o prefixo da chave (aact_prod_ / aact_hmlg_)
   ASAAS_WEBHOOK_TOKEN=...            # o mesmo token do passo 2
   COBRANCA_VALOR_CENTAVOS=120000     # R$ 1.200,00
   COBRANCA_DIAS_TRIAL=7
   COBRANCA_DIAS_TOLERANCIA=3
   ```

4. Recriar o app e o worker (o worker do agente lê `ASAAS_API_KEY` para saber
   se a cobrança está ligada):

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app worker scheduler
   ```

Sem `ASAAS_API_KEY` a cobrança fica **desligada**: ninguém entra em teste, ninguém
é bloqueado, e `/assinatura` redireciona para o CRM.

## Testar no sandbox

- **PIX:** gere o QR em `/assinatura`; no painel do sandbox, abra a cobrança e use
  *Confirmar recebimento*. A tela libera sozinha em até 3 segundos.
- **Cartão:** use os cartões de teste da documentação do Asaas (seção *Sandbox*),
  um de aprovação e um de recusa. Na recusa a tela mostra a mensagem do Asaas e
  oferece PIX.
- **Webhook local:** exponha `localhost:3000` com um túnel (`cloudflared tunnel --url http://localhost:3000`)
  e aponte o webhook do sandbox para `https://<túnel>/api/v1/webhooks/asaas`.

## Virar do sandbox para a produção

Webhook, chave e dados do sandbox **não** passam para a conta de produção. Na virada:

1. **Conta de produção pronta:** aprovada pelo Asaas, com **chave PIX cadastrada**
   (sem ela a geração do QR falha) e cartão de crédito habilitado.
2. **Chave nova** (`aact_prod_…`) em `ASAAS_API_KEY`, sem o `$`. O ambiente vem do
   prefixo da chave — `ASAAS_AMBIENTE` contraditório só gera aviso no log.
3. **Token novo** em `ASAAS_WEBHOOK_TOKEN` e **webhook cadastrado de novo** na conta
   de produção (mesmos campos do passo 2 de *Ligar*).
4. **Ids do sandbox fora do banco:** `assinaturas.asaas_customer_id` /
   `asaas_subscription_id` que vieram de testes no sandbox não existem na produção
   (o checkout leva 404 e o cron falha para aquela organização). Zere esses ids e
   apague as `cobrancas` de teste antes de cobrar.
5. Recriar app, worker e scheduler e conferir: `GET /v3/myAccount` com a chave nova
   responde 200, e o *Enviar teste* do webhook no painel do Asaas volta 200.

Chave recusada (401) aparece para quem paga como "problema de configuração, avise o
suporte" — nunca como cartão recusado — e fica no log como `asaas: chave recusada (401)`.

## Segurança

- **Dados de cartão** atravessam o servidor a caminho do Asaas e não são gravados
  em lugar nenhum: nem banco, nem log, nem audit, nem Sentry (o Sentry descarta
  o corpo das requisições e mascara sequências de cartão). Guardamos só os 4
  últimos dígitos e a bandeira. `tests/unit/checkout-da-assinatura.test.ts` vigia.
- **O cliente não edita a própria assinatura:** as tabelas `assinaturas` e
  `cobrancas` têm policy só de leitura e o GRANT de escrita revogado de `anon` e
  `authenticated` (`tests/invariants/assinaturas-rls.test.ts`).
- **Webhook:** token comparado em tempo constante; evento repetido é ignorado
  (`eventos_asaas.evento_id` UNIQUE); `pago_ate` é recalculado das cobranças
  pagas, nunca somado por evento — reentrega e `CONFIRMED`+`RECEIVED` da mesma
  cobrança não dão mês grátis; estorno recua o acesso sozinho.
- **Rate limit** no checkout: 20 tentativas/hora por IP e 10 por organização.

## Rede de segurança

O cron `billing-conciliar` (de hora em hora, no `scheduler`) consulta no Asaas as
assinaturas em teste, inadimplentes ou perto do vencimento e aplica pagamentos
que o webhook tenha perdido.

## Onde ver

- Cliente: **Configurações › Assinatura** (situação, faturas, trocar cartão,
  mudar para PIX, cancelar) e `/assinatura` (pagar).
- Plataforma: `/admin/tenants/<id>` → bloco **Assinatura** (datas, vínculo Asaas,
  chave de isenção).
- Auditoria: ações `billing.*`.
