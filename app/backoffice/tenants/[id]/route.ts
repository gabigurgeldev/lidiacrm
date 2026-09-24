import { rotaDoBackoffice, lerJson } from "@/lib/backoffice/rota";
import { alteracaoDePlanoSchema, alterarPlano } from "@/lib/backoffice/tenants";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return rotaDoBackoffice(req, async ({ admin, corpo }) => {
    const plano = lerJson(corpo, alteracaoDePlanoSchema);
    if (!plano) return { status: 422, body: { error: "invalid_body" } };
    return alterarPlano(admin, id, plano);
  });
}
