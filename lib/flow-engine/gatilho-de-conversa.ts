/**
 * Flow Engine — o gatilho de MENSAGEM pergunta "é o começo de uma conversa?".
 *
 * Uma pré-triagem (nome, sistema, problema) só faz sentido quando o cliente
 * CHEGA — a primeira mensagem dele, ou a que vem depois de um tempo sem
 * conversa. Armar em toda mensagem fazia a própria resposta ao menu armar o
 * fluxo de novo.
 *
 * Mora no matcher, ANTES de criar a execução, pelo mesmo motivo do filtro de
 * canal (`trigger-matcher.ts`): decidir no `execute` do nó deixaria uma
 * execução nascida morta para cada mensagem de toda conversa em andamento.
 *
 * Parte pura (`decidirArmar`) + leitura (`precondicoesDaConversa`). A leitura
 * falha ABERTA para "arma": perder a triagem por um erro de leitura é pior do
 * que rodá-la uma vez a mais, e `uma_por_contato` ainda segura a duplicata.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { triggerMessageReceivedConfigSchema, type TriggerMessageReceivedConfig } from "./nodes/gatilhos-e-menu";

export type DecisaoDeArmar = { armar: true } | { armar: false; motivo: "conversa_em_andamento" | "pessoa_atendendo" };

export function decidirArmar(p: {
  config: TriggerMessageReceivedConfig;
  /** Última mensagem NESTA conversa antes desta (qualquer sentido), se houver. */
  ultimaMensagemAntes: Date | null;
  /** Quando esta mensagem chegou. */
  agora: Date;
  pessoaAtendendo: boolean;
}): DecisaoDeArmar {
  if (p.config.pular_se_pessoa_atende && p.pessoaAtendendo) {
    return { armar: false, motivo: "pessoa_atendendo" };
  }
  if (p.config.quando === "conversa_nova_ou_retorno" && p.ultimaMensagemAntes !== null) {
    const silencioMs = p.agora.getTime() - p.ultimaMensagemAntes.getTime();
    if (silencioMs < p.config.horas_de_silencio * 3_600_000) {
      return { armar: false, motivo: "conversa_em_andamento" };
    }
  }
  return { armar: true };
}

/** Lê o config do gatilho com os defaults — config velho ou torto vira "o de sempre". */
export function lerConfigDoGatilhoDeMensagem(config: Record<string, unknown>): TriggerMessageReceivedConfig {
  const parsed = triggerMessageReceivedConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : triggerMessageReceivedConfigSchema.parse({});
}

/** O gatilho precisa olhar a conversa? Só quando algum campo de triagem está ligado. */
export function precisaOlharAConversa(config: TriggerMessageReceivedConfig): boolean {
  return config.quando !== "toda_mensagem" || config.pular_se_pessoa_atende;
}

export async function precondicoesDaConversa(
  admin: SupabaseClient,
  p: {
    organizationId: string;
    contactId: string | null;
    conversationId: string | null;
    messageId: string | null;
    chegouEm: Date;
    config: TriggerMessageReceivedConfig;
  },
): Promise<DecisaoDeArmar> {
  if (!precisaOlharAConversa(p.config) || p.contactId === null) return { armar: true };

  try {
    // "Conversa em andamento" é NESTA conversa — a do número em que o cliente
    // escreveu —, e não em qualquer conversa do contato. Medido em produção
    // (2026-10-08): o dono testou do celular pessoal, que é o mesmo número que
    // recebe os avisos de passagem por OUTRA conexão; o aviso de 1 minuto antes
    // contou como conversa e a triagem nunca começou. Sem a conversa no evento,
    // o contato é o melhor recorte que há.
    let anterior = admin
      .from("messages")
      .select("created_at")
      .eq("organization_id", p.organizationId);
    anterior =
      p.conversationId !== null
        ? anterior.eq("conversation_id", p.conversationId)
        : anterior.eq("contact_id", p.contactId);
    anterior = anterior
      .neq("type", "system")
      .lt("created_at", p.chegouEm.toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (p.messageId !== null) anterior = anterior.neq("id", p.messageId);

    const [msg, conversa] = await Promise.all([
      anterior.maybeSingle(),
      p.conversationId === null
        ? Promise.resolve({ data: null, error: null })
        : admin
            .from("conversations")
            .select("status, assignee_kind")
            .eq("organization_id", p.organizationId)
            .eq("id", p.conversationId)
            .maybeSingle(),
    ]);

    const ultima = (msg.data as { created_at?: string } | null)?.created_at ?? null;
    const c = conversa.data as { status?: string; assignee_kind?: string | null } | null;
    const pessoaAtendendo = c !== null && (c.assignee_kind === "user" || c.status === "claimed");

    return decidirArmar({
      config: p.config,
      ultimaMensagemAntes: ultima === null ? null : new Date(ultima),
      agora: p.chegouEm,
      pessoaAtendendo,
    });
  } catch (err) {
    logger.warn("flow-engine: pré-condição da conversa não foi lida — armando", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { armar: true };
  }
}
