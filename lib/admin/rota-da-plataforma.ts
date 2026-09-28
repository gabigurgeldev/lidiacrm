/**
 * Prelúdio comum das rotas de MUTAÇÃO do painel da plataforma: gate de
 * platform admin + corpo validado por Zod, devolvendo a resposta de erro
 * pronta. Mesmo comportamento do padrão já espalhado por
 * `app/api/v1/admin/**` (try/catch em volta de `requirePlatformAdmin`, que
 * redireciona lançando), só que escrito uma vez.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail } from "@/lib/api/wrappers";
import type { ApiError as ApiErrorBody } from "@/lib/api/wrappers";
import {
  requirePlatformAdmin,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { validateRequest } from "@/lib/schemas";

type Falha = { ok: false; response: NextResponse<ApiErrorBody> };

export async function exigirPlatformAdmin(
  requestId: string,
): Promise<{ ok: true; ctx: PlatformAdminContext } | Falha> {
  try {
    return { ok: true, ctx: await requirePlatformAdmin() };
  } catch {
    return {
      ok: false,
      response: fail("forbidden", "Platform admin required", 403, { requestId }),
    };
  }
}

export async function lerCorpo<T>(
  schema: z.ZodType<T>,
  req: NextRequest,
  requestId: string,
): Promise<{ ok: true; dados: T } | Falha> {
  try {
    return { ok: true, dados: await validateRequest(schema, req) };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        ok: false,
        response: fail(err.code, err.message, err.status, {
          details: err.details as Record<string, unknown> | undefined,
          requestId,
        }),
      };
    }
    throw err;
  }
}
