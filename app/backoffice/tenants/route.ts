import { rotaDoBackoffice, lerJson } from "@/lib/backoffice/rota";
import { criarTenant, pedidoDeTenantSchema } from "@/lib/backoffice/tenants";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return rotaDoBackoffice(req, async ({ admin, corpo }) => {
    const pedido = lerJson(corpo, pedidoDeTenantSchema);
    if (!pedido) return { status: 422, body: { error: "invalid_body" } };
    return criarTenant(admin, pedido, env.NEXT_PUBLIC_APP_URL);
  });
}
