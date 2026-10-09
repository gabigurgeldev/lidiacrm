/**
 * Provedor, modelo e chave com que um agente NOVO nasce — sem a pessoa ter de
 * escolher nada.
 *
 * Saiu de `app/actions/onboarding/createDefaultAgent.ts` quando "Criar agente
 * com IA" passou a precisar da mesma decisão. Duas cópias desta escolha
 * divergiriam exatamente onde ela já errou uma vez: publicar `"anthropic"`
 * literal para quem escolheu outro provedor na instalação.
 *
 * Nunca lança: devolve o desfecho para quem chama decidir o que a tela diz.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { escolherModeloDoProvedor } from "@/lib/ai/agents/escolher-modelo";
import { chaveDePlataforma } from "@/lib/ai/runtime/agent";

export type ProvedorDoAgente =
  | { ok: true; provider: string; modelId: string; credentialId: string | null }
  /**
   * Há provedor e modelo, mas nenhuma chave utilizável: nem credencial validada
   * da organização, nem chave da instalação no ambiente. O modelo vem junto
   * porque um RASCUNHO ainda pode nascer assim — publicar é que não.
   */
  | { ok: false; reason: "sem_chave"; provider: string; modelId: string }
  | {
      ok: false;
      reason: "no_model";
      provider: string;
      /**
       * Catálogo vazio pede esperar (ou forçar) a sincronização; catálogo cheio
       * sem nenhum modelo que sirva pede trocar de provedor. Conselhos opostos.
       */
      motivo: "catalogo_vazio" | "nenhum_com_ferramentas";
    }
  | { ok: false; reason: "failed"; message: string };

/**
 * O provedor de IA que a instalação escolheu.
 *
 * O instalador grava a resposta em `organizations.settings.llm.provider`.
 * `settings` é jsonb livre: leitura defensiva, igual à do agent-engine.
 */
export function provedorDaInstalacao(settings: unknown): string {
  const llm = (settings as { llm?: unknown } | null)?.llm;
  const provider = (llm as { provider?: unknown } | null | undefined)?.provider;
  return typeof provider === "string" && provider.trim() !== "" ? provider : "anthropic";
}

export async function resolverProvedorDoAgente(
  admin: SupabaseClient,
  orgId: string,
): Promise<ProvedorDoAgente> {
  // Erro de leitura aqui NÃO pode virar "assume anthropic": decidir sem saber
  // qual provedor a instalação escolheu é exatamente o defeito de origem.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) return { ok: false, reason: "failed", message: orgErr.message };

  const provider = provedorDaInstalacao(org?.settings);

  // O modelo daquele provedor. Não existe fallback literal: um id de outro
  // provedor (ou inventado) produz o pior desfecho do produto — o agente
  // responde texto plausível e nunca cria o lead nem move o card. A regra de
  // escolha (com o requisito de ferramentas) vive em `escolherModeloDoProvedor`.
  const { data: modelos } = await admin
    .from("ai_models")
    .select("model_id, is_default_for_provider, supports_tools, input_price_per_million_cents, output_price_per_million_cents")
    .eq("provider", provider)
    .is("deprecated_at", null);

  const escolha = escolherModeloDoProvedor(
    (modelos ?? []) as Parameters<typeof escolherModeloDoProvedor>[0],
  );
  if (!escolha.escolhido) return { ok: false, reason: "no_model", provider, motivo: escolha.motivo };

  // Credencial validada da organização vence; na falta dela, `null` significa
  // "a chave da instalação". `validated_at` não nulo é exigência de
  // `loadCredential`: credencial que o provedor não confirmou não serve ao turno.
  const { data: credencial } = await admin
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .limit(1)
    .maybeSingle();

  const credentialId = (credencial?.id as string | undefined) ?? null;
  if (!credentialId && !chaveDePlataforma(provider)) {
    return { ok: false, reason: "sem_chave", provider, modelId: escolha.modelId };
  }
  return { ok: true, provider, modelId: escolha.modelId, credentialId };
}
