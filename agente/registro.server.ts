/**
 * O ÚNICO arquivo do módulo `agente/` que usa o client de service role.
 *
 * Existe porque `agente_conversas`/`agente_mensagens` não têm policy de escrita
 * para `authenticated` (migration 0250) — de propósito: a anon key vai para o
 * navegador, e com escrita aberta qualquer um forjaria 50 perguntas no nome de
 * outra pessoa e esgotaria o limite dela.
 *
 * As regras que fazem o service role ser aceitável AQUI:
 *  - só toca as duas tabelas `agente_*`;
 *  - `userId` e `organizationId` chegam do chamador, que os tira da SESSÃO
 *    (`requireRole`), nunca do corpo da requisição;
 *  - toda leitura filtra `user_id` (e a conversa, também `organization_id`):
 *    uma `conversa_id` de outra pessoa no corpo devolve "não achei", e a
 *    pergunta abre conversa nova.
 *
 * As ferramentas (`agente/ferramentas.ts`) NUNCA importam este arquivo nem o
 * admin client — `tests/unit/agente-isolamento.test.ts` reprova.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export type PapelDaMensagem = "user" | "assistant";

export interface MensagemGravada {
  role: PapelDaMensagem;
  content: string;
  created_at: string;
}

export interface ConsumoDaResposta {
  tokensIn: number;
  tokensOut: number;
  custoUsd: number | null;
  modelo: string;
  ferramentas: string[];
}

export interface RegistroDoAgente {
  /** Perguntas (`role='user'`) da pessoa desde `desde` — em qualquer organização. */
  contarPerguntas(userId: string, desde: Date): Promise<number>;
  /** A conversa, se for desta pessoa nesta organização; senão `null`. */
  conversaValida(userId: string, organizationId: string, conversaId: string): Promise<string | null>;
  abrirConversa(userId: string, organizationId: string): Promise<string>;
  /** As últimas `n` mensagens da conversa, da mais antiga para a mais nova. */
  historico(userId: string, conversaId: string, n: number): Promise<MensagemGravada[]>;
  /** A conversa mais recente da pessoa nesta organização. */
  ultimaConversa(userId: string, organizationId: string): Promise<string | null>;
  /** Grava a pergunta e devolve o id dela. */
  gravarPergunta(userId: string, organizationId: string, conversaId: string, texto: string): Promise<string>;
  /**
   * A pergunta `perguntaId` está entre as `limite` primeiras do dia da pessoa?
   * Ordem por `created_at, id` — a mesma para todas as requisições que olham.
   */
  dentroDoLimite(userId: string, desde: Date, perguntaId: string, limite: number): Promise<boolean>;
  /** Apaga a pergunta que estourou o limite (só dela, só desta pessoa). */
  descartarPergunta(userId: string, perguntaId: string): Promise<void>;
  gravarResposta(
    userId: string,
    organizationId: string,
    conversaId: string,
    texto: string,
    consumo: ConsumoDaResposta,
  ): Promise<void>;
}

export function registroNoBanco(admin: SupabaseClient = createAdminClient()): RegistroDoAgente {
  return {
    async contarPerguntas(userId, desde) {
      const { count, error } = await admin
        .from("agente_mensagens")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", desde.toISOString());
      if (error) throw new Error(`agente_mensagens (contagem): ${error.message}`);
      return count ?? 0;
    },

    async conversaValida(userId, organizationId, conversaId) {
      const { data, error } = await admin
        .from("agente_conversas")
        .select("id")
        .eq("id", conversaId)
        .eq("user_id", userId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw new Error(`agente_conversas (leitura): ${error.message}`);
      return (data as { id: string } | null)?.id ?? null;
    },

    async abrirConversa(userId, organizationId) {
      const { data, error } = await admin
        .from("agente_conversas")
        .insert({ user_id: userId, organization_id: organizationId })
        .select("id")
        .single();
      if (error || !data) throw new Error(`agente_conversas (criação): ${error?.message ?? "sem linha"}`);
      return (data as { id: string }).id;
    },

    async historico(userId, conversaId, n) {
      const { data, error } = await admin
        .from("agente_mensagens")
        .select("role, content, created_at")
        .eq("conversa_id", conversaId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(n);
      if (error) throw new Error(`agente_mensagens (histórico): ${error.message}`);
      return ((data ?? []) as MensagemGravada[]).reverse();
    },

    async ultimaConversa(userId, organizationId) {
      const { data, error } = await admin
        .from("agente_conversas")
        .select("id")
        .eq("user_id", userId)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`agente_conversas (última): ${error.message}`);
      return (data as { id: string } | null)?.id ?? null;
    },

    async gravarPergunta(userId, organizationId, conversaId, texto) {
      const { data, error } = await admin
        .from("agente_mensagens")
        .insert({
          user_id: userId,
          organization_id: organizationId,
          conversa_id: conversaId,
          role: "user",
          content: texto,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`agente_mensagens (pergunta): ${error?.message ?? "sem linha"}`);
      return (data as { id: string }).id;
    },

    async dentroDoLimite(userId, desde, perguntaId, limite) {
      const { data, error } = await admin
        .from("agente_mensagens")
        .select("id")
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", desde.toISOString())
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limite);
      if (error) throw new Error(`agente_mensagens (limite): ${error.message}`);
      return ((data ?? []) as Array<{ id: string }>).some((m) => m.id === perguntaId);
    },

    async descartarPergunta(userId, perguntaId) {
      const { error } = await admin
        .from("agente_mensagens")
        .delete()
        .eq("id", perguntaId)
        .eq("user_id", userId)
        .eq("role", "user");
      if (error) throw new Error(`agente_mensagens (descarte): ${error.message}`);
    },

    async gravarResposta(userId, organizationId, conversaId, texto, consumo) {
      const { error } = await admin.from("agente_mensagens").insert({
        user_id: userId,
        organization_id: organizationId,
        conversa_id: conversaId,
        role: "assistant",
        content: texto,
        // Só os NOMES: o resultado bruto de uma ferramenta não é guardado. O
        // TEXTO da resposta, porém, pode citar nome de cliente — e este
        // histórico ainda não entra no redact da LGPD nem na retenção.
        tool_calls: consumo.ferramentas.length > 0 ? consumo.ferramentas : null,
        tokens_in: consumo.tokensIn,
        tokens_out: consumo.tokensOut,
        custo_usd: consumo.custoUsd,
        modelo: consumo.modelo,
      });
      if (error) throw new Error(`agente_mensagens (resposta): ${error.message}`);
    },
  };
}
