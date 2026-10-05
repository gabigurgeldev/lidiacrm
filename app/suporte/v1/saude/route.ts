/** GET /suporte/v1/saude — Contrato de Suporte v1 (docs/integracoes/contrato-de-suporte-v1.md). */
import { SISTEMA } from "@/lib/suporte/acoes";
import { VERSAO_DO_CONTRATO } from "@/lib/suporte/contrato";
import { rotaDeSuporte } from "@/lib/suporte/rota";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return rotaDeSuporte(req, { auditoria: "suporte.leitura", recurso: "suporte_saude" }, async () => ({
    status: 200,
    body: { ok: true, sistema: SISTEMA, versao_contrato: VERSAO_DO_CONTRATO },
  }));
}
