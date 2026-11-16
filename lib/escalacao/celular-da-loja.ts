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
 *
 * ## A resposta automática do WhatsApp Business também NÃO pode pausar
 *
 * A saudação e a mensagem de ausência que a loja configura no app do WhatsApp
 * Business saem do PRÓPRIO aparelho, e o webhook as entrega exatamente como uma
 * mensagem digitada no celular — o payload não traz marca nenhuma que as
 * distinga (conferido no `_data` cru). Medido numa instalação real (nov/2026):
 * a saudação saía ~1 s depois de TODA cliente nova, pausava a conversa antes
 * de o agente responder, e o agente passou 13 dias sem falar com ninguém — com
 * a passagem para a dona e o aviso no WhatsApp dela configurados e nunca
 * disparados.
 *
 * O que separa a resposta automática da resposta pronta que a atendente manda
 * à mão é a PROPORÇÃO de vezes em que o mesmo texto saiu segundos depois da
 * cliente: a saudação, em 179 de 193 conversas; a ausência, em 138 de 162; a
 * resposta pronta de sinal ("Para agendarmos…"), em 7 de 54. Então: texto do
 * aparelho que chega até 15 s depois da cliente E que, nos últimos 30 dias, já
 * saiu assim em pelo menos 5 OUTRAS conversas, em ao menos 70% das vezes, é
 * automático — fica no histórico, mas não pausa. Atraso sozinho não serve: a
 * atendente que está no papo responde em 1 a 5 s com frequência.
 *
 * O preço conhecido: as primeiras 5 conversas depois de a loja ligar uma
 * saudação nova ainda pausam (a régua precisa ver o texto se repetir). Errar
 * para o lado da pausa é o lado barato — o oposto é o agente falando por cima
 * de uma pessoa.
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

/** Até quantos segundos depois da cliente uma mensagem do aparelho pode ser automática. */
export const JANELA_DA_RESPOSTA_AUTOMATICA_S = 15;
/** Em quantas OUTRAS conversas o mesmo texto precisa ter saído rápido. */
export const MIN_CONVERSAS_DA_AUTOMATICA = 5;
/** Fração mínima das conversas com aquele texto em que ele saiu rápido. */
export const PROPORCAO_DA_AUTOMATICA = 0.7;
const HISTORICO_DA_AUTOMATICA_DIAS = 30;
/** Teto da leitura do histórico: a saudação de uma loja movimentada se repete muito. */
const LIMITE_DO_HISTORICO = 500;

export interface EnvioAnteriorDoMesmoTexto {
  conversation_id: string;
  segundos_apos_cliente: number | null;
}

function rapida(segundos: number | null | undefined): boolean {
  return typeof segundos === "number" && segundos >= 0 && segundos <= JANELA_DA_RESPOSTA_AUTOMATICA_S;
}

/**
 * Decisão pura: a mensagem do aparelho é a resposta automática do WhatsApp
 * Business? Conta CONVERSAS distintas, não mensagens — a mesma saudação
 * repetida num chat só não diz nada sobre a loja.
 */
export function pareceRespostaAutomatica(p: {
  segundosAposCliente: number | null;
  anteriores: readonly EnvioAnteriorDoMesmoTexto[];
}): boolean {
  if (!rapida(p.segundosAposCliente)) return false;
  const conversas = new Map<string, boolean>();
  for (const a of p.anteriores) {
    conversas.set(a.conversation_id, (conversas.get(a.conversation_id) ?? false) || rapida(a.segundos_apos_cliente));
  }
  let rapidas = 0;
  for (const r of conversas.values()) if (r) rapidas += 1;
  return rapidas >= MIN_CONVERSAS_DA_AUTOMATICA && rapidas / conversas.size >= PROPORCAO_DA_AUTOMATICA;
}

/**
 * Segundos entre a última mensagem da cliente nesta conversa e `agora`. O
 * ingest grava o valor em `messages.metadata.segundos_apos_cliente` de toda
 * mensagem do aparelho — é o histórico que `pareceRespostaAutomatica` lê.
 * `null` quando não há mensagem da cliente ou a leitura falhou.
 */
export async function segundosDesdeACliente(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  agora: Date = new Date(),
): Promise<number | null> {
  const { data, error } = await admin
    .from("messages")
    .select("created_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const desde = new Date((data as { created_at: string }).created_at).getTime();
  if (Number.isNaN(desde)) return null;
  return Math.max(0, Math.round((agora.getTime() - desde) / 100) / 10);
}

async function ehRespostaAutomatica(admin: SupabaseClient, c: ConversaDoCelular, agora: Date): Promise<boolean> {
  const corpo = c.corpo?.trim() ? c.corpo : null;
  const segundos = c.segundosAposCliente ?? null;
  // Só consulta o histórico quando a mensagem PODE ser automática.
  if (corpo === null || !rapida(segundos)) return false;
  const desde = new Date(agora.getTime() - HISTORICO_DA_AUTOMATICA_DIAS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("conversation_id, metadata")
    .eq("organization_id", c.organizationId)
    .eq("direction", "outbound")
    .eq("sent_via", "external_device")
    .eq("body", corpo)
    .neq("conversation_id", c.conversationId)
    .gte("created_at", desde)
    .limit(LIMITE_DO_HISTORICO);
  if (error) {
    logger.warn("[escalacao.celular] histórico do texto indisponível; pauso", {
      conversation_id: c.conversationId,
      error: error.message,
    });
    return false;
  }
  const anteriores = ((data ?? []) as Array<{ conversation_id: string; metadata: unknown }>).map((m) => {
    const meta = (m.metadata ?? {}) as { segundos_apos_cliente?: unknown };
    return {
      conversation_id: m.conversation_id,
      segundos_apos_cliente: typeof meta.segundos_apos_cliente === "number" ? meta.segundos_apos_cliente : null,
    };
  });
  return pareceRespostaAutomatica({ segundosAposCliente: segundos, anteriores });
}

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
  /** Texto da mensagem do aparelho — usado só para reconhecer a resposta automática. */
  corpo?: string | null;
  /** Ver `segundosDesdeACliente`. */
  segundosAposCliente?: number | null;
}

export type ResultadoDaPausa = "pausou" | "ja_pausada" | "eco_provavel" | "resposta_automatica" | "falhou";

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

  if (await ehRespostaAutomatica(admin, c, agora)) {
    logger.info("[escalacao.celular] resposta automática do aparelho; não pauso", {
      conversation_id: c.conversationId,
      segundos_apos_cliente: c.segundosAposCliente ?? null,
    });
    return "resposta_automatica";
  }

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
