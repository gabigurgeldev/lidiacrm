/**
 * Ingestão do intermediário de conta: webhook → contato, conversa, mensagem.
 *
 * A leitura do payload é do módulo puro ao lado (`./webhook.ts`); aqui moram os
 * EFEITOS. A separação não é estética: o que decide (isto é mensagem? de quem?)
 * dá para provar sem banco, e o que escreve fica pequeno o bastante para caber
 * na cabeça.
 *
 * ─── Reusa as MESMAS operações canônicas dos outros canais ──────────────────
 *
 * `fn_upsert_wa_contact` / `fn_upsert_wa_conversation` /
 * `fn_mark_conversation_message` já resolvem contato e conversa de forma
 * atômica, e são agnósticas de provider. O que muda aqui é só o mapeamento do
 * payload — escrever uma segunda resolução de contato criaria a divergência que
 * a migration 0027 (wa_identity canônica) eliminou, e que voltou a aparecer no
 * outro intermediado quando a entrada e a saída resolviam identidades
 * diferentes: duas linhas de contato para a mesma pessoa.
 *
 * ─── `aplicarEfeitosPosEntrada` NÃO é opcional ──────────────────────────────
 *
 * É o que aplica opt-out, abre a demanda, acelera o pipeline de eventos e acorda
 * o agente. O canal oficial nasceu sem ele e o resultado medido foi 806
 * despachos de agente no canal por QR contra ZERO no oficial: mensagens
 * gravadas, inbox mostrando, e o robô mudo. Quem escrever o quinto canal deve
 * copiar esta chamada antes de qualquer outra coisa.
 *
 * ─── Idempotência ───────────────────────────────────────────────────────────
 *
 * O provedor reentrega quando não recebe 200. A chave é
 * `(organization_id, external_id)` no INSERT, com captura do `23505`.
 *
 * ⚠️ E há um caso que os outros canais não têm: o payload pode chegar SEM id
 * (`external_id: null`), porque o formato não é documentado e o campo pode ter
 * outro nome. Sem id não existe chave de idempotência — a reentrega duplicaria.
 * Por isso, quando falta o id, a janela curta de deduplicação por
 * (conversa, corpo, minuto) fecha o buraco. Não é tão boa quanto a chave única;
 * é o que dá para garantir sem inventar um id que o provedor não reconhece.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { encontrarContatoPorTelefone } from "@/lib/channels/contato-por-telefone";

import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import { lerEventoStevo } from "./webhook";

export interface ResultadoIngestaoStevo {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  conversationId?: string;
  messageId?: string;
  /** Por que foi ignorado ou falhou — é o que se lê quando "sumiu". */
  reason?: string;
}

/** Prévia da conversa: mídia vira rótulo, nunca URL. */
function previa(texto: string | null, tipo: string): string {
  if (texto) return texto.slice(0, 120);
  if (tipo === "image") return "📷 Foto";
  if (tipo === "video") return "🎥 Vídeo";
  if (tipo === "audio") return "🎤 Áudio";
  if (tipo === "sticker") return "Figurinha";
  return "📎 Arquivo";
}

/**
 * A mesma mensagem já entrou, num payload sem id?
 *
 * Janela de um minuto sobre (conversa, direção, corpo). Curta de propósito: a
 * reentrega do provedor acontece em segundos, enquanto um cliente que manda
 * "oi" duas vezes em minutos diferentes está mesmo mandando duas — e engolir a
 * segunda seria pior que duplicar a primeira.
 */
async function jaEntrouSemId(
  admin: SupabaseClient,
  input: { organizationId: string; conversationId: string; body: string | null; sentAt: Date },
): Promise<boolean> {
  const desde = new Date(input.sentAt.getTime() - 60_000).toISOString();
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("conversation_id", input.conversationId)
    .eq("body", input.body ?? "")
    .gte("sent_at", desde)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Grava um evento já lido e autenticado.
 *
 * Recebe o `channel_session_id` resolvido pela rota (que é quem conhece o
 * token): este módulo não descobre de quem é o webhook, só escreve o que já se
 * sabe de quem é. A organização vem da MESMA fonte — nunca do corpo (issue #236).
 */
export async function ingestStevoInbound(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; payload: unknown },
): Promise<ResultadoIngestaoStevo> {
  const evento = lerEventoStevo(input.payload);

  if (evento.tipo === "ignorado") return { status: "ignored", reason: evento.motivo };
  // Evento de conexão não gera mensagem. O estado do canal tem dono próprio (o
  // health check pergunta ao provedor), e gravar aqui criaria um segundo
  // escritor para a mesma coluna, com ordem de chegada não garantida.
  if (evento.tipo === "conexao") return { status: "ignored", reason: "evento_de_conexao" };

  const orgId = input.organizationId;

  // Celular BR grava COM o nono dígito; a busca por variantes reencontra a
  // grafia sem ele. Sem isso a mesma pessoa vira dois cadastros e a conversa
  // parte ao meio — medido no canal oficial antes do conserto.
  const existente = await encontrarContatoPorTelefone(admin, orgId, evento.telefone!);
  const telefone = existente?.phone_number
    ? canonicalPhoneBR(existente.phone_number)
    : canonicalPhoneBR(`+${evento.telefone}`);

  const { data: contactId, error: erroContato } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: "phone",
    p_phone: telefone,
    p_lid: null,
    p_chat_id: evento.telefone,
    p_notify: null,
  } as never);
  if (erroContato || !contactId) {
    return { status: "failed", reason: `contato: ${erroContato?.message ?? "sem id"}` };
  }

  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "fn_upsert_wa_conversation" as never,
    { p_org: orgId, p_contact: contactId as string, p_session: input.channelSessionId } as never,
  );
  if (erroConversa || !conversationId) {
    return { status: "failed", reason: `conversa: ${erroConversa?.message ?? "sem id"}` };
  }

  if (
    !evento.externalId &&
    (await jaEntrouSemId(admin, {
      organizationId: orgId,
      conversationId: conversationId as string,
      body: evento.texto,
      sentAt: evento.enviadaEm,
    }))
  ) {
    return { status: "duplicate", reason: "sem_id_janela_de_um_minuto" };
  }

  const agora = new Date().toISOString();
  // ⚠️ A mensagem que o operador mandou pelo CELULAR entra como `outbound` +
  // `external_device`. Marcá-la como entrada faria o agente responder à própria
  // empresa, e a janela de 24h abriria sozinha sem o cliente ter escrito.
  const daEmpresa = evento.daEmpresa;

  const { data: inserida, error: erroInsert } = await admin
    .from("messages")
    .insert({
      organization_id: orgId,
      conversation_id: conversationId as string,
      // NOT NULL na tabela. Esquecê-lo já fez, no canal oficial, o insert falhar
      // e a rota responder "recebido: 1" com nada gravado.
      channel_session_id: input.channelSessionId,
      contact_id: contactId as string,
      external_id: evento.externalId,
      type: evento.tipoDeMensagem,
      direction: daEmpresa ? "outbound" : "inbound",
      status: daEmpresa ? "sent" : "delivered",
      body: evento.texto,
      media_url: evento.midiaUrl,
      media_mime: evento.midiaMime,
      sent_via: "external_device",
      sent_at: evento.enviadaEm.toISOString(),
      ...(daEmpresa ? {} : { delivered_at: agora }),
      metadata: { origem: "stevo_webhook" },
    })
    .select("id")
    .maybeSingle();

  if (erroInsert) {
    // 23505 = a mesma `external_id` já entrou. Não é erro: é reentrega.
    if (erroInsert.code === "23505") return { status: "duplicate" };
    return { status: "failed", reason: `mensagem: ${erroInsert.message}` };
  }

  // Carimba a conversa — é ISTO que move `last_inbound_at` e abre a janela de
  // 24h nas instâncias oficiais.
  await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: conversationId as string,
    p_direction: daEmpresa ? "outbound" : "inbound",
    p_preview: previa(evento.texto, evento.tipoDeMensagem),
    p_at: evento.enviadaEm.toISOString(),
  } as never);

  const messageId = (inserida as { id: string } | null)?.id ?? "";

  // Só o que ENTROU dispara os efeitos: opt-out, demanda e agente reagem à fala
  // do cliente. Rodá-los sobre a nossa própria mensagem faria o agente responder
  // ao operador — e um "pare de me mandar" digitado pelo atendente bloquearia o
  // cliente.
  if (!daEmpresa) {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId: orgId,
      contactId: contactId as string,
      conversationId: conversationId as string,
      messageId: messageId || null,
      channelSessionId: input.channelSessionId,
      texto: evento.texto,
      nomeDoContato: null,
      origem: "stevo_webhook",
    });
  }

  return { status: "ingested", messageId, conversationId: conversationId as string };
}
