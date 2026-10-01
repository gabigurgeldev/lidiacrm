/**
 * Por qual serviço esta organização fala — a pergunta da TELA do agente.
 *
 * Lê as mesmas fontes que o envio (`lib/agent-engine/edge/crm/voz-da-organizacao.ts`):
 * o `TTS_BASE_URL` da instalação e, sem ele, a chave da OpenRouter (credencial
 * ativa e validada da organização, ou a `OPENROUTER_API_KEY` da instalação). Se
 * a tela consultasse outra coisa, ela ofereceria vozes de um serviço enquanto o
 * envio usa o outro — e a voz escolhida nunca chegaria ao cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { servicoDeVoz, type ServicoDeVoz } from "./vozes";

export async function servicoDeVozDaOrganizacao(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ServicoDeVoz | null> {
  const ttsBaseUrl = process.env.TTS_BASE_URL;
  if (ttsBaseUrl?.trim()) return servicoDeVoz({ ttsBaseUrl, chaveOpenRouter: false });
  const { data } = await supabase
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "openrouter")
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .limit(1)
    .maybeSingle();
  return servicoDeVoz({
    ttsBaseUrl,
    chaveOpenRouter: data !== null || Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  });
}
