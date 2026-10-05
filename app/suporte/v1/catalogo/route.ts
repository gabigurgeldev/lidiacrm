/** GET /suporte/v1/catalogo — o que o agente de suporte pode ler e corrigir aqui. */
import { CATALOGO } from "@/lib/suporte/acoes";
import { rotaDeSuporte } from "@/lib/suporte/rota";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return rotaDeSuporte(req, { auditoria: "suporte.leitura", recurso: "suporte_catalogo" }, async () => ({
    status: 200,
    body: CATALOGO,
  }));
}
