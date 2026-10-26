/**
 * Leitura do catálogo de tags (`crm_tags`, migration 0248) para quem ESCREVE
 * tag por um caminho que não é a tela — o agente (MCP), fluxos, automações.
 *
 * O caminho de máquina normaliza para minúscula (`conversationTagSchema`); o
 * catálogo guarda a grafia que a pessoa escolheu ("VIP"). Sem esta ponte, o
 * agente aplicaria "vip", o trigger criaria uma SEGUNDA tag no catálogo e a
 * coluna vinculada a "VIP" nunca receberia o contato.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizarTags } from "@/lib/tags/normalizar";

/**
 * Troca cada nome pela grafia do catálogo quando há um casamento ignorando a
 * caixa. Nome sem par fica como veio (o trigger o registra no catálogo).
 */
export async function grafiaDoCatalogo(
  supabase: SupabaseClient,
  organizationId: string,
  nomes: readonly string[],
): Promise<string[]> {
  const limpos = normalizarTags(nomes);
  if (limpos.length === 0) return [];

  const { data, error } = await supabase
    .from("crm_tags")
    .select("name")
    .eq("organization_id", organizationId)
    .eq("is_archived", false);
  if (error || !data) return limpos;

  const porMinuscula = new Map<string, string>();
  for (const { name } of data as Array<{ name: string }>) {
    const chave = name.toLocaleLowerCase("pt-BR");
    if (!porMinuscula.has(chave)) porMinuscula.set(chave, name);
  }
  return normalizarTags(limpos.map((n) => porMinuscula.get(n.toLocaleLowerCase("pt-BR")) ?? n));
}
