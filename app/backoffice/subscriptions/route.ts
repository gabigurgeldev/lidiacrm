import { rotaDoBackoffice } from "@/lib/backoffice/rota";
import { assinaturas } from "@/lib/backoffice/tenants";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const desde = new URL(req.url).searchParams.get("updated_since");
  return rotaDoBackoffice(req, async ({ admin }) => {
    if (desde && Number.isNaN(Date.parse(desde)))
      return { status: 422, body: { error: "invalid_updated_since" } };
    return assinaturas(admin, desde ? new Date(desde).toISOString() : null);
  });
}
