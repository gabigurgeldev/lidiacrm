import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { varrerDiretorio } from "@/lib/admin/diretorio-auth";
import { estadoDaConta, type EstadoDaConta } from "@/lib/admin/gestao-usuarios";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  role: z.enum(["viewer", "agent", "manager", "admin"]).optional(),
  q: z.string().optional(),
  status: z.enum(["ativo", "suspenso", "pendente"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface CursorPayload {
  last_sign_in_at: string | null;
  user_id: string;
  organization_id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    ) as CursorPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/users
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_error", "Invalid query params", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { tenant_id, role, q, status, cursor, limit } = parsed.data;
  const admin = createAdminClient();
  const cursorPayload = cursor ? decodeCursor(cursor) : null;

  // O join com `auth.users` acontece em memória, não no Postgres: `auth` não é
  // um dos schemas expostos ao PostgREST (`supabase/config.toml` expõe `public`,
  // `storage` e `graphql_public`), então qualquer `.schema("auth")` responde
  // PGRST106 "Invalid schema: auth" mesmo com service role. O vínculo vem do
  // PostgREST; email, nome e último login vêm do GoTrue (Auth Admin API).

  // Step 1: query user_organizations + organizations
  type UoRow = {
    user_id: string;
    organization_id: string;
    role: string;
    accepted_at: string | null;
    revoked_at: string | null;
    organizations: {
      display_name: string;
      slug: string;
    } | null;
  };

  let uoQuery = admin
    .from("user_organizations")
    .select(
      `
      user_id,
      organization_id,
      role,
      accepted_at,
      revoked_at,
      organizations!inner(display_name, slug)
    `,
    )
    .order("user_id", { ascending: false });

  if (tenant_id) {
    uoQuery = uoQuery.eq("organization_id", tenant_id);
  }
  if (role) {
    uoQuery = uoQuery.eq("role", role);
  }

  const { data: uoRows, error: uoError } = await uoQuery;

  if (uoError) {
    return fail("internal_error", "Query failed", 500, {
      requestId,
      details: uoError.message,
    });
  }

  if (!uoRows || uoRows.length === 0) {
    void audit({
      action: "platform_admin.users_listed",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      requestId,
      metadata: { filters: { tenant_id, role, status, has_q: !!q }, result_count: 0 },
    });
    return ok([], { requestId, meta: { has_more: false, cursor: null } });
  }

  // Step 2: get unique user IDs
  const userIds = [...new Set((uoRows as unknown as UoRow[]).map((r) => r.user_id))];

  // Step 3: resolve os usuários no diretório do Auth. A varredura (paginada,
  // com teto e parada por página vazia) mora em `lib/admin/diretorio-auth.ts`,
  // compartilhada com o relatório e o export — ver o cabeçalho de lá.
  const varredura = await varrerDiretorio(admin, new Set(userIds));
  if (!varredura.ok) {
    return fail(
      "upstream_unavailable",
      varredura.motivo === "auth_indisponivel"
        ? "Auth indisponível"
        : "Varredura do diretório de usuários atingiu o teto de páginas sem resolver todos os vínculos",
      503,
      { requestId, details: varredura.detalhe },
    );
  }
  const authMap = varredura.usuarios;

  // Step 4: build joined rows
  type JoinedRow = {
    user_id: string;
    organization_id: string;
    role: string;
    accepted_at: string | null;
    revoked_at: string | null;
    tenant_name: string;
    tenant_slug: string;
    email: string | null;
    full_name: string | null;
    last_sign_in_at: string | null;
    created_at: string;
    email_confirmed_at: string | null;
    banned_until: string | null;
    tem_mfa: boolean;
    /** Estado da CONTA (Auth), não do vínculo — o do vínculo é `revoked_at`. */
    status: EstadoDaConta;
  };

  const agora = new Date();
  let joined: JoinedRow[] = (uoRows as unknown as UoRow[]).flatMap((uo) => {
    const u = authMap.get(uo.user_id);
    // Chegar aqui sem usuário só é possível depois de o diretório inteiro ter
    // sido varrido com sucesso (erro do GoTrue já abortou lá em cima): é um
    // vínculo apontando para usuário removido do Auth, e some da lista.
    if (!u) return [];
    const org = uo.organizations;
    if (!org) return [];
    return [
      {
        user_id: uo.user_id,
        organization_id: uo.organization_id,
        role: uo.role,
        accepted_at: uo.accepted_at,
        revoked_at: uo.revoked_at,
        tenant_name: org.display_name,
        tenant_slug: org.slug,
        email: u.email ?? null,
        full_name: u.full_name,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at,
        banned_until: u.banned_until,
        tem_mfa: u.tem_mfa,
        status: estadoDaConta(u, agora),
      },
    ];
  });

  if (status) {
    joined = joined.filter((r) => r.status === status);
  }

  // Step 5: apply q filter (email or full_name ilike)
  if (q) {
    const lq = q.toLowerCase();
    joined = joined.filter(
      (r) =>
        r.email?.toLowerCase().includes(lq) ||
        r.full_name?.toLowerCase().includes(lq),
    );
  }

  // Step 6: sort by last_sign_in_at desc nulls last, then user_id+org_id
  joined.sort((a, b) => {
    if (!a.last_sign_in_at && !b.last_sign_in_at) {
      return a.user_id < b.user_id ? -1 : 1;
    }
    if (!a.last_sign_in_at) return 1;
    if (!b.last_sign_in_at) return -1;
    const diff =
      new Date(b.last_sign_in_at).getTime() -
      new Date(a.last_sign_in_at).getTime();
    if (diff !== 0) return diff;
    const uid = a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
    if (uid !== 0) return uid;
    return a.organization_id < b.organization_id ? -1 : 1;
  });

  // Step 7: apply cursor
  if (cursorPayload) {
    const { last_sign_in_at: cLsi, user_id: cUid, organization_id: cOid } =
      cursorPayload;
    const cursorIdx = joined.findIndex(
      (r) =>
        r.last_sign_in_at === cLsi &&
        r.user_id === cUid &&
        r.organization_id === cOid,
    );
    if (cursorIdx !== -1) {
      joined = joined.slice(cursorIdx + 1);
    }
  }

  // Step 8: paginate
  const has_more = joined.length > limit;
  const page = has_more ? joined.slice(0, limit) : joined;
  const lastRow = page.at(-1);
  const nextCursor =
    has_more && lastRow
      ? encodeCursor({
          last_sign_in_at: lastRow.last_sign_in_at,
          user_id: lastRow.user_id,
          organization_id: lastRow.organization_id,
        })
      : null;

  void audit({
    action: "platform_admin.users_listed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      filters: { tenant_id, role, status, has_q: !!q },
      result_count: page.length,
    },
  });

  return ok(page, { requestId, meta: { has_more, cursor: nextCursor } });
}
