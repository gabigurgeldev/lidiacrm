/**
 * Os canais ativos de uma organização numerados "1", "2"… na ordem em que foram
 * criados — a referência curta que o agente de suporte mostra ao cliente e
 * devolve como parâmetro de `reconectar_canal` (lib/suporte). Mora aqui porque
 * saber se o canal TEM sessão para reiniciar é pergunta de provider.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CanalNumerado = {
  ref: string;
  id: string;
  status: string | null;
  nome: string | null;
  telefone: string | null;
  temSessao: boolean;
};

export function mascararTelefone(t: string | null): string {
  const d = (t ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `final ${d.slice(-4)}` : "sem número";
}

/** Canais ativos numerados "1", "2"… — a mesma ordem no diagnóstico e na ação. */
export async function canaisNumerados(admin: SupabaseClient, organizationId: string): Promise<CanalNumerado[]> {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, status, display_name, phone_number, waha_session_name, archived_at, created_at")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  return ((data ?? []) as Array<{
    id: string;
    status: string | null;
    display_name: string | null;
    phone_number: string | null;
    waha_session_name: string | null;
  }>).map((c, i) => ({
    ref: String(i + 1),
    id: c.id,
    status: c.status,
    nome: c.display_name,
    telefone: c.phone_number,
    temSessao: c.waha_session_name !== null,
  }));
}
