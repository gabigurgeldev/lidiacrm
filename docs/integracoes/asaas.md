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
(migration 0217). Organizações criadas pelo Back Office de afiliados nascem
isentas (o Back Office cobra por fora).

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
   ASAAS_AMBIENTE=sandbox             # "producao" para cobrar de verdade
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
