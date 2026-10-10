/**
 * A volta de uma enquete ou lista NOSSA — a parte que não depende do canal.
 *
 * Cada canal sabe LER o seu evento (o voto do QR, o `list_reply` do oficial) e
 * entrega aqui o mesmo par: qual mensagem foi respondida e o que foi escolhido.
 * Daqui sai a mensagem de ENTRADA do tipo `text` com o rótulo COMPLETO da opção
 * no corpo — lido da `metadata.opcoes` da pergunta, que é a fonte de verdade —
 * e a procedência em `metadata.resposta_interativa`.
 *
 * É isso que faz o menu do fluxo, o agente, o coordenador e a detecção de STOP
 * funcionarem sem saber que houve um toque: para eles chegou um texto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import {
  opcaoEscolhida,
  opcoesDaMetadata,
  type OpcoesGravadas,
  type RespostaInterativa,
} from "./opcoes-interativas";

// Sem o genérico do banco: os dois ingests chamam isto, e um deles usa o client
// sem tipo. As colunas lidas aqui são poucas e estreitadas à mão abaixo.
type Admin = SupabaseClient;

/** A linha de saída (enquete/lista) à qual um voto ou seleção responde. */
export interface MensagemDeOpcoes {
  id: string;
  contact_id: string;
  conversation_id: string;
  metadata: Record<string, unknown>;
  opcoes: OpcoesGravadas;
}

/**
 * Acha a pergunta pelo id que o CANAL deu a ela.
 *
 * `exato` para quem devolve o mesmo id do envio; `sufixo` para quem devolve
 * formas diferentes do mesmo id (a forma completa `<dono>_<chat>_<id>` num
 * lado, só o `<id>` no outro) — o fim é o que as duas formas têm em comum.
 * Quem sabe qual é o caso é o leitor do canal, não esta função.
 */
export async function mensagemDeOpcoes(
  admin: Admin,
  organizationId: string,
  idNoCanal: { exato: string } | { sufixo: string },
): Promise<MensagemDeOpcoes | null> {
  const alvo = "exato" in idNoCanal ? idNoCanal.exato : idNoCanal.sufixo;
  if (!alvo) return null;
  let consulta = admin
    .from("messages")
    .select("id, contact_id, conversation_id, metadata")
    .eq("organization_id", organizationId)
    .eq("direction", "outbound")
    .in("type", ["poll", "list"]);
  consulta =
    "exato" in idNoCanal ? consulta.eq("external_id", alvo) : consulta.like("external_id", `%${alvo}`);
  const { data, error } = await consulta
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn("resposta_interativa: não li a pergunta de origem", { detail: error.message });
    return null;
  }
  if (!data) return null;
  const linha = data as { id: string; contact_id: string; conversation_id: string; metadata: unknown };
  const opcoes = opcoesDaMetadata(linha.metadata);
  if (!opcoes) return null;
  return {
    id: linha.id,
    contact_id: linha.contact_id,
    conversation_id: linha.conversation_id,
    metadata: (linha.metadata ?? {}) as Record<string, unknown>,
    opcoes,
  };
}

/**
 * O corpo e a procedência da mensagem de entrada que representa a escolha.
 * Sem a pergunta de origem (apagada, de antes desta versão), o rótulo que o
 * canal devolveu é o melhor que há — e ainda casa no menu pelo texto.
 */
export function respostaDaEscolha(
  formato: RespostaInterativa["formato"],
  origem: MensagemDeOpcoes | null,
  escolha: { id?: string | null; rotulo?: string | null },
): { corpo: string; resposta: RespostaInterativa } | null {
  const opcao = origem ? opcaoEscolhida(origem.opcoes.opcoes, escolha) : null;
  const corpo = opcao?.label ?? escolha.rotulo?.trim() ?? "";
  if (corpo === "") return null;
  return {
    corpo,
    resposta: {
      formato,
      mensagem_origem_id: origem?.id ?? null,
      pergunta: origem?.opcoes.pergunta ?? null,
      opcao_id: opcao?.id ?? escolha.id ?? null,
      opcao_label: corpo,
    },
  };
}

/**
 * Grava na PERGUNTA o que foi escolhido — é o que a bolha da enquete/lista no
 * inbox mostra ("escolheu: X") sem procurar a resposta na conversa. Melhor
 * esforço: a resposta já entrou como mensagem; perder isto só tira o selo.
 */
export async function marcarEscolhaNaOrigem(
  admin: Admin,
  organizationId: string,
  origem: MensagemDeOpcoes,
  escolha: { opcao_id: string | null; opcao_label: string },
): Promise<void> {
  const { error } = await admin
    .from("messages")
    .update({
      metadata: { ...origem.metadata, escolha: { ...escolha, em: new Date().toISOString() } },
    })
    .eq("organization_id", organizationId)
    .eq("id", origem.id);
  if (error) {
    logger.warn("resposta_interativa: não marquei a escolha na pergunta", { detail: error.message });
  }
}

/**
 * O voto chegou e o canal não o decifrou. O cliente tocou numa opção e ninguém
 * sabe qual — quem esperava a escolha fica parado. Um aviso por conversa aberto
 * por vez: o mesmo cliente tocando de novo não vira dez avisos.
 */
export async function avisarEscolhaNaoLida(
  admin: Admin,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  const { data: aberto, error: erroDaBusca } = await admin
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("kind", "escolha_nao_lida")
    .eq("status", "open")
    .eq("ref_id", conversationId)
    .limit(1);
  // Falha ABERTA: entre repetir um aviso e engolir o único sinal, repetir.
  if (!erroDaBusca && aberto !== null && aberto.length > 0) return;

  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: organizationId,
    kind: "escolha_nao_lida",
    severity: "warn",
    title: "Um cliente escolheu uma opção que não conseguimos ler",
    body:
      "O cliente tocou numa opção da enquete, mas o WhatsApp entregou o voto sem dizer qual foi. " +
      "Quem esperava a resposta (fluxo ou agente) continua esperando. Abra a conversa e pergunte de novo — " +
      "ou peça para ele escrever a opção.",
    ref_kind: "conversation",
    ref_id: conversationId,
  });
  if (error) {
    logger.error("resposta_interativa: aviso de escolha não lida não entrou na Central", {
      organization_id: organizationId,
      error: error.message,
    });
  }
}
