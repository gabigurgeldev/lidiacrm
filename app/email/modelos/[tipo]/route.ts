/**
 * GET /email/modelos/<tipo> — o HTML que o GoTrue baixa para montar os e-mails
 * do login (`GOTRUE_MAILER_TEMPLATES_<TIPO>=https://<app>/email/modelos/<tipo>`).
 *
 * Público de propósito: quem pede é o contêiner do Auth, sem sessão. Não expõe
 * nada que o próprio e-mail não mostraria — é a casca com a marca da
 * INSTALAÇÃO (`marcaDaSaida(null)`, classe B: antes de haver organização) e as
 * variáveis do GoTrue ainda cruas.
 *
 * `?assunto=1` devolve o assunto em texto puro — é o valor de
 * `GOTRUE_MAILER_SUBJECTS_<TIPO>`, conferível sem abrir o HTML.
 */
import type { NextRequest } from "next/server";

import { marcaDaSaida } from "@/lib/branding/saida";
import { assuntoDoLogin, ehTipoDoLogin, modeloDoLogin } from "@/lib/email/modelos-do-login";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tipo: string }> },
): Promise<Response> {
  const { tipo } = await ctx.params;
  if (!ehTipoDoLogin(tipo)) {
    return new Response("Modelo não encontrado.", { status: 404 });
  }
  const marca = await marcaDaSaida(null);

  if (req.nextUrl.searchParams.get("assunto") === "1") {
    return new Response(assuntoDoLogin(tipo, marca.nome), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  }

  return new Response(modeloDoLogin(tipo, marca), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // O GoTrue guarda o modelo em memória; 5 min basta para uma troca de logo
      // aparecer sem reiniciar nada.
      "Cache-Control": "public, max-age=300",
    },
  });
}
