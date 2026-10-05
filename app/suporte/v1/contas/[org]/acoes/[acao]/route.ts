/**
 * POST /suporte/v1/contas/:org/acoes/:acao — executa uma correção do catálogo.
 *
 * Chega aqui só depois do SIM do cliente (conferido pelo CRM do agente) e da
 * reconferência de posse da conta (lib/suporte/rota.ts). Idempotente pela
 * `Idempotency-Key`.
 */
import { HEADER_IDEMPOTENCIA } from "@/lib/suporte/contrato";
import { acaoExiste, executarAcao } from "@/lib/suporte/acoes";
import { erro, lerJson, rotaDeSuporte } from "@/lib/suporte/rota";

export const dynamic = "force-dynamic";

const QualquerObjeto = {
  safeParse(v: unknown): { success: true; data: Record<string, unknown> } | { success: false } {
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? { success: true, data: v as Record<string, unknown> }
      : { success: false };
  },
};

export async function POST(req: Request, { params }: { params: Promise<{ org: string; acao: string }> }) {
  const { org, acao } = await params;
  return rotaDeSuporte(
    req,
    { orgDoCaminho: org, auditoria: "suporte.acao_executada", recurso: `suporte_acao:${acao.slice(0, 40)}` },
    async ({ admin, corpo, conta }) => {
      if (!acaoExiste(acao)) return erro(404, "acao_desconhecida", "Ação fora do catálogo.");
      const dados = lerJson(corpo, QualquerObjeto);
      if (!dados) return erro(422, "params_invalidos", "Corpo JSON inválido.");
      return executarAcao(admin, conta!.organizationId, acao, dados, req.headers.get(HEADER_IDEMPOTENCIA));
    },
  );
}
