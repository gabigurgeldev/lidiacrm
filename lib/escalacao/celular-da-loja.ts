/**
 * O atendente que responde PELO CELULAR da loja também tira o automático.
 *
 * ## O defeito que este arquivo conserta
 *
 * Mensagem enviada pelo composer do CRM silencia o agente por 5 minutos
 * (`extendBotSilence`, em `app/api/v1/messages/_handler.ts`). Mensagem digitada
 * no WhatsApp do próprio celular da loja não silenciava NADA: o ingest gravava a
 * linha como outbound e seguia. Medido numa floricultura real (2026-10-15): a
 * atendente mandou as fotos dos buquês com o preço pelo celular, a cliente
 * escolheu, e a IA continuou respondendo por cima — com outro valor. A cliente
 * recebeu duas vozes ao mesmo tempo, e a dona pediu para desligar a IA.
 *
 * Quem abre o celular e responde está ASSUMINDO a conversa. Então a mensagem do
 * celular pausa o automático daquela conversa até alguém devolver — o mesmo
 * silêncio durável (`'infinity'`) do botão "Pausar o automático"
 * (`app/api/v1/conversations/[id]/pause-ai/route.ts`), e pelo mesmo motivo não
 * toca `contacts.force_human`: pausar UMA conversa não é bloquear o cliente.
 *
 * ## A volta também pelo celular
 *
 * Uma pausa que só se desfaz pelo computador prende a conversa no humano para
 * sempre numa loja que atende só pelo celular — que é o caso que motivou isto.
 * Então o atendente devolve mandando `#ia` na própria conversa. A devolução
 * passa por `devolverAtendimentoAoAgente`, a MESMA regra do botão da tela, do
 * fluxo e da ferramenta do catálogo: um caminho próprio soltaria só uma das
 * três travas (o defeito que `retomada.ts` documenta no cabeçalho).
 *
 * O comando não vira mensagem no histórico — o agente leria "#ia" como se fosse
 * conversa com o cliente. Ele vira auditoria e linha do tempo, pela retomada.
 *
 * ## O eco do próprio envio NÃO pode pausar
 *
 * Todo envio do CRM (IA, composer, fluxo) volta pelo webhook como `fromMe`. O
 * ingest descarta o eco quando já acha a linha pelo `external_id` — mas o envio
 * grava a linha ANTES de falar com o canal (`queued`, `external_id` nulo) e só
 * carimba o id depois. Um eco que chegue nessa janela parece mensagem do
 * celular, e a IA se pausaria com a PRÓPRIA resposta. Por isso a pausa recua
 * quando a conversa tem um envio do CRM ainda sem id há pouco tempo: perder uma
 * pausa (a próxima mensagem do celular pausa) é muito mais barato que um agente
 * que se cala sozinho.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { logger } from "@/lib/logger";

import { devolverAtendimentoAoAgente, type RetomadaResultado } from "./retomada";

/** O mesmo literal do handoff e do botão de pausa: `> now()` é sempre verdadeiro. */
const SILENCIO_DURAVEL = "infinity";
const MOTIVO_DA_PAUSA = "Atendente respondeu pelo celular da loja";

/**
 * Janela em que um envio do CRM sem `external_id` ainda pode estar a caminho do
 * canal. O envio carimba o id em segundos; dois minutos cobrem uma fila lenta
 * sem engolir a resposta humana seguinte.
 */
export const JANELA_DO_ECO_MS = 2 * 60 * 1000;

/**
 * Comandos de devolução. Comparados com a mensagem INTEIRA (sem acento, sem
 * caixa, sem espaço nas pontas): uma frase que só CONTÉM "#ia" é conversa com o
 * cliente, não comando.
 */
export const COMANDOS_DE_DEVOLUCAO = ["#ia", "#bot", "#robo", "#automatico"] as const;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function ehComandoDeDevolucao(corpo: string | null | undefined): boolean {
  if (!corpo) return false;
  return (COMANDOS_DE_DEVOLUCAO as readonly string[]).includes(normalizar(corpo));
}

/** Ator das escritas: não há usuário do CRM do outro lado, há o aparelho. */
function atorDoCelular(channelSessionId: string) {
  return { type: "webhook_source" as const, id: `celular:${channelSessionId}` };
}

export interface ConversaDoCelular {
  organizationId: string;
  conversationId: string;
  contactId: string;
  channelSessionId: string;
  requestId: string;
}

export type ResultadoDaPausa = "pausou" | "ja_pausada" | "eco_provavel" | "falhou";

export async function pausarAutomaticoPeloCelular(
  admin: SupabaseClient,
  c: ConversaDoCelular,
  agora: Date = new Date(),
): Promise<ResultadoDaPausa> {
  const desde = new Date(agora.getTime() - JANELA_DO_ECO_MS).toISOString();
  const { data: envioEmVoo, error: ecoErr } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", c.organizationId)
    .eq("conversation_id", c.conversationId)
    .eq("direction", "outbound")
    .is("external_id", null)
    .in("status", ["queued", "sending"])
    .neq("sent_via", "external_device")
    .gte("created_at", desde)
    .limit(1)
    .maybeSingle();
  if (ecoErr) {
    logger.warn("[escalacao.celular] não consegui checar envio em voo; não pauso", {
      conversation_id: c.conversationId,
      error: ecoErr.message,
    });
    return "falhou";
  }
  if (envioEmVoo) return "eco_provavel";

  const { data: atualizada, error: updErr } = await admin
    .from("conversations")
    .update({ bot_silenced_until: SILENCIO_DURAVEL, last_handoff_reason: MOTIVO_DA_PAUSA })
    .eq("id", c.conversationId)
    .eq("organization_id", c.organizationId)
    // Já pausada (passagem, botão ou mensagem anterior do celular): nada a fazer,
    // e reescrever o motivo apagaria o motivo de verdade da pausa.
    .or("bot_silenced_until.is.null,bot_silenced_until.neq.infinity")
    .not("status", "in", "(closed,archived)")
    .select("id")
    .maybeSingle();
  if (updErr) {
    logger.warn("[escalacao.celular] pausa pelo celular falhou", {
      conversation_id: c.conversationId,
      error: updErr.message,
    });
    return "falhou";
  }
  if (!atualizada) return "ja_pausada";

  await audit({
    action: "conversation.ai_paused",
    organizationId: c.organizationId,
    resourceType: "conversation",
    resourceId: c.conversationId,
    requestId: c.requestId,
    metadata: { via: "celular_da_loja", channel_session_id: c.channelSessionId },
  });

  await registrarTrocaDeComando({
    supabase: admin,
    organizationId: c.organizationId,
    conversationId: c.conversationId,
    contactId: c.contactId,
    tipo: "conversation_ai_paused",
    actor: atorDoCelular(c.channelSessionId),
    motivo: `${MOTIVO_DA_PAUSA}. Para devolver ao automático, mande ${COMANDOS_DE_DEVOLUCAO[0]} na conversa.`,
    payload: { via: "celular_da_loja" },
  });

  return "pausou";
}

export async function devolverAutomaticoPeloCelular(
  admin: SupabaseClient,
  c: ConversaDoCelular,
): Promise<RetomadaResultado> {
  const r = await devolverAtendimentoAoAgente(
    {
      supabase: admin,
      organizationId: c.organizationId,
      actor: atorDoCelular(c.channelSessionId),
      requestId: c.requestId,
    },
    { conversationId: c.conversationId },
  );
  if (!r.ok) {
    logger.warn("[escalacao.celular] devolução pelo celular falhou", {
      conversation_id: c.conversationId,
      erro: r.erro,
      detalhe: r.detalhe,
    });
  }
  return r;
}
