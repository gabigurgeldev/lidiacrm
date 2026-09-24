import { rotaDoBackoffice } from "@/lib/backoffice/rota";
import { alternarSuspensao } from "@/lib/backoffice/tenants";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return rotaDoBackoffice(req, ({ admin }) => alternarSuspensao(admin, id, true));
}
