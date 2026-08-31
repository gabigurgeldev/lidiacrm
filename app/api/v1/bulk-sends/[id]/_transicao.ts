/**
 * AS TRANSIÇÕES DE ESTADO DE UM DISPARO — em um lugar só.
 *
 * ═══ Por que `update ... where status in (...)` e nunca `select` + `update` ═══
 *
 * Porque entre ler o estado e gravar o novo cabe outro clique. Dois `start`
 * simultâneos num `select`-then-`update` viram dois disparos rodando a mesma
 * lista; com a transição no WHERE, o segundo afeta ZERO linhas e é recusado com
 * 409. A condição de corrida morre no banco, não numa checagem em TypeScript.
 *
 * ═══ Por que `next_send_at` acompanha o estado ═══
 *
 * `running` sem relógio nunca é reclamado pelo claim — a campanha ficaria
 * "rodando" e parada para sempre, que é o pior estado possível: mente progresso.
 * `paused` COM relógio seria reclamado e voltaria a enviar sozinho, o contrário
 * do que a pessoa pediu ao pausar. Cada transição escreve os dois juntos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoDoDisparo =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "done"
  | "cancelled";

export interface ResultadoDaTransicao {
  ok: boolean;
  /** Estado atual quando a transição foi recusada — a frase da tela usa isto. */
  estadoAtual?: string;
}

/**
 * Aplica a transição SE o estado atual estiver entre os aceitos. Devolve
 * `ok:false` com o estado real quando não — a rota traduz em 409.
 */
export async function transicionar(
  supabase: SupabaseClient,
  entrada: {
    id: string;
    organizationId: string;
    de: EstadoDoDisparo[];
    patch: Record<string, unknown>;
  },
): Promise<ResultadoDaTransicao> {
  const { data, error } = await supabase
    .from("bulk_sends")
    .update({ ...entrada.patch, updated_at: new Date().toISOString() })
    .eq("id", entrada.id)
    .eq("organization_id", entrada.organizationId)
    .in("status", entrada.de)
    .select("id");

  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) return { ok: true };

  // Zero linhas: ou o estado não era um dos aceitos, ou o disparo não existe
  // nesta organização. A leitura seguinte separa os dois casos para a frase.
  const { data: atual } = await supabase
    .from("bulk_sends")
    .select("status")
    .eq("id", entrada.id)
    .eq("organization_id", entrada.organizationId)
    .maybeSingle();

  return { ok: false, estadoAtual: (atual as { status: string } | null)?.status };
}

/** A frase de recusa, em pt-BR, dizendo o que a pessoa pode fazer. */
export function fraseDaRecusa(acao: string, estadoAtual: string | undefined): string {
  if (!estadoAtual) return "Disparo não encontrado.";
  const nomes: Record<string, string> = {
    draft: "ainda é rascunho",
    scheduled: "está agendado",
    running: "está rodando",
    paused: "está pausado",
    done: "já terminou",
    cancelled: "foi cancelado",
  };
  return `Não dá para ${acao}: este disparo ${nomes[estadoAtual] ?? `está em "${estadoAtual}"`}.`;
}
