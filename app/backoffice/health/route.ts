import { rotaDoBackoffice } from "@/lib/backoffice/rota";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return rotaDoBackoffice(req, async () => ({ status: 200, body: { ok: true, version: "1" } }));
}
