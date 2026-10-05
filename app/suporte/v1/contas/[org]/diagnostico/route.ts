/** GET /suporte/v1/contas/:org/diagnostico — o que está quebrado nesta conta agora. */
import { diagnosticar } from "@/lib/suporte/diagnostico";
import { rotaDeSuporte } from "@/lib/suporte/rota";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return rotaDeSuporte(
    req,
    { orgDoCaminho: org, auditoria: "suporte.leitura", recurso: "suporte_diagnostico" },
    async ({ admin, conta }) => ({ status: 200, body: await diagnosticar(admin, conta!.organizationId) }),
  );
}
