/**
 * `POST /backoffice/billing/sync` — o Back Office pede o histórico de cobrança.
 *
 * O botão de `/admin/cobrancas` do Back Office chama esta rota em laço, com o
 * `next_cursor` da resposta anterior, até ele vir nulo (60 s por chamada). Cada
 * chamada reenvia uma página de `cobrancas` como `invoice.updated` e, no fim,
 * o estado de `assinaturas` como `subscription.updated` — os dois com
 * `event_id` `crm_sync_…`, pela mesma fila e pelo mesmo `POST /api/v1/events`
 * de sempre (`lib/backoffice/saida.ts`). Nunca `payment.succeeded`: pagamento
 * antigo reenviado viraria comissão.
 *
 * Corpo `{ cursor?: string | null }` — e só isso: a organização de cada evento
 * vem da linha do banco. Resposta
 * `{ invoices, subscriptions, enqueued, sent, next_cursor }`.
 *
 * Audita (`backoffice.sincronizacao_run`) só quando a chamada teve efeito —
 * enfileirou ou entregou algo. Página que já tinha ido inteira não é mutação.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { audit } from "@/lib/audit";
import { lerJson, rotaDoBackoffice } from "@/lib/backoffice/rota";
import {
  backofficeLigado,
  type CursorDaSincronizacao,
  decodificarCursor,
  sincronizarComBackoffice,
} from "@/lib/backoffice/saida";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const pedidoSchema = z.object({ cursor: z.string().min(1).max(512).nullable().optional() });

export function POST(req: Request) {
  return rotaDoBackoffice(req, async ({ admin, corpo }) => {
    // Corpo vazio = primeira página.
    const pedido = corpo.trim() === "" ? {} : lerJson(corpo, pedidoSchema);
    if (!pedido) return { status: 422, body: { error: "invalid_body" } };

    let cursor: CursorDaSincronizacao | null = null;
    if (pedido.cursor) {
      cursor = decodificarCursor(pedido.cursor);
      if (!cursor) return { status: 422, body: { error: "invalid_cursor" } };
    }

    // Sem `BACKOFFICE_URL` + `BACKOFFICE_API_KEY` o CRM não tem para onde mandar.
    if (!backofficeLigado()) return { status: 503, body: { error: "backoffice_outbound_not_configured" } };

    const requestId = randomUUID();
    try {
      const r = await sincronizarComBackoffice(admin, cursor);
      if (r.enqueued > 0 || r.sent > 0) {
        void audit({
          action: "backoffice.sincronizacao_run",
          bypassedRls: true,
          requestId,
          metadata: {
            fase: cursor?.fase ?? "inicio",
            invoices: r.invoices,
            subscriptions: r.subscriptions,
            enqueued: r.enqueued,
            sent: r.sent,
            ultima_pagina: r.next_cursor === null,
          },
        });
      }
      return { status: 200, body: { ...r } };
    } catch (e) {
      logger.warn("backoffice: sincronização falhou", {
        request_id: requestId,
        erro: e instanceof Error ? e.message : String(e),
      });
      return { status: 500, body: { error: "sync_failed", request_id: requestId } };
    }
  });
}
