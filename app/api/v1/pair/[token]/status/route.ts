/**
 * GET /api/v1/pair/[token]/status — PÚBLICA, sem sessão.
 *
 * A página de pareamento pergunta a cada 3s: o QR já foi escaneado? É também
 * aqui que o link MORRE ao conectar (`consumed_at`) — no servidor, quando ele
 * mesmo vê o canal em `WORKING`. Um endpoint "já conectei" chamado pelo cliente
 * seria uma forma de qualquer um matar o link de outro.
 *
 * ─── O que esta rota NÃO devolve ───────────────────────────────────────────
 *
 * Nome da organização, telefone, id do canal, nada do tenant além do apelido da
 * linha. Quem abre o link é o dono do celular, não um usuário do CRM — e o
 * apelido existe só para ele confirmar que está conectando o número certo.
 *
 * `organization_id` sai do TOKEN (via `lerLinkDePareamento`), nunca da URL ou
 * do corpo: é a regra do repo para todo handler que usa service role.
 */
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { linhaParaPagina } from "@/lib/channels/pareamento/canal";
import {
  lerLinkDePareamento,
  marcarLinkComoUsado,
  segundosAteExpirar,
} from "@/lib/channels/pareamento/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 3s de polling × 30 min = ~600 chamadas legítimas. 90/min dá folga de 4×. */
const TETO_POR_MINUTO = 90;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  // Por TOKEN e não por IP: o celular do cliente pode estar atrás do mesmo NAT
  // de outros, e limitar por IP puniria quem não fez nada. O token é o que uma
  // varredura teria de adivinhar, e é ele que precisa ficar caro de tentar.
  const limite = await checkRateLimit(`pair:status:${token.slice(0, 32)}`, TETO_POR_MINUTO, 60);
  if (!limite.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "muitas tentativas" } },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  const admin = createAdminClient();

  let leitura;
  try {
    leitura = await lerLinkDePareamento(admin, token);
  } catch {
    // Banco fora do ar NÃO vira "link inválido": isso mandaria o cliente pedir
    // link novo a cada tentativa, para sempre, por um problema que não é dele.
    return NextResponse.json(
      { error: { code: "unavailable", message: "tente de novo em instantes" } },
      { status: 503 },
    );
  }

  if (!leitura.ok) {
    // Inexistente, expirado, cancelado e usado respondem TODOS 404. Só o
    // `motivo` difere — e ele é "desconhecido" para o token que nunca existiu,
    // então a rota não vira oráculo de tokens que já existiram.
    return NextResponse.json(
      { error: { code: "invalid_link", message: leitura.motivo } },
      { status: 404 },
    );
  }

  const { link } = leitura;
  const canal = await linhaParaPagina(admin, link.organizationId, link.channelSessionId);

  // Canal excluído no meio do caminho: o link morre junto. Parear um canal
  // arquivado deixaria o aparelho ligado a uma linha que ninguém atende.
  if (!canal || canal.arquivado) {
    return NextResponse.json(
      { error: { code: "invalid_link", message: "cancelado" } },
      { status: 404 },
    );
  }

  const conectado = canal.status === "WORKING";
  if (conectado) await marcarLinkComoUsado(admin, link.id);

  return NextResponse.json(
    {
      data: {
        linha: canal.nome,
        status: canal.status,
        conectado,
        expira_em_s: segundosAteExpirar(link.expiresAt),
      },
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
