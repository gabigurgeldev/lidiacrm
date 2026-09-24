import { rotaDoBackoffice } from "@/lib/backoffice/rota";
import { estatisticas } from "@/lib/backoffice/tenants";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return rotaDoBackoffice(req, ({ admin }) => estatisticas(admin));
}
