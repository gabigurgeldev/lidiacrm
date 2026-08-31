import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { criarUsuarioNaOrganizacao } from "@/lib/auth/criar-usuario";
import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  q: z.string().optional(),
  status: z.enum(["active", "suspended", "onboarding", "redacted"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const createSchema = z.object({
  display_name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  legal_name: z.string().min(2).max(255).optional(),
  cnpj: z.string().optional(),
  plan: z.enum(["standard", "pro", "enterprise"]).default("standard"),
  owner_email: z.string().email(),
  /**
   * Com a senha, o dono é CRIADO junto e já entra. Sem ela, o tenant nasce sem
   * ninguém dentro — que era o comportamento único até aqui: `owner_email` era
   * coletado, virava um hash no audit, e nenhuma conta ou vínculo nascia. Ou
   * seja, criar tenant pelo painel produzia uma organização em que ninguém
   * conseguia entrar.
   *
   * Opcional, e não obrigatório, para não quebrar quem já chama esta rota por
   * API sem senha.
   */
  owner_password: z.string().min(8).optional(),
});

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface CursorPayload {
  created_at: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as CursorPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/tenants
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

  const { q, status, cursor, limit } = parsed.data;
  const admin = createAdminClient();
  const cursorPayload = cursor ? decodeCursor(cursor) : null;

  let query = admin
    .from("organizations")
    .select(
      `
      id,
      slug,
      display_name,
      legal_name,
      cnpj,
      status,
      onboarded_at,
      suspended_at,
      created_at,
      user_count:user_organizations(count),
      conversations_count:conversations(count)
    `,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (status === "onboarding") {
    // Estado derivado: ativo no banco, onboarding ainda não concluído.
    query = query.eq("status", "active").is("onboarded_at", null);
  } else if (status) {
    query = query.eq("status", status);
  }

  if (q) {
    query = query.or(
      `display_name.ilike.%${q}%,slug::text.ilike.%${q}%,cnpj.ilike.%${q}%`,
    );
  }

  if (cursorPayload) {
    query = query.or(
      `created_at.lt.${cursorPayload.created_at},and(created_at.eq.${cursorPayload.created_at},id.lt.${cursorPayload.id})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    return fail("internal_error", "Query failed", 500, {
      requestId,
      details: error.message,
    });
  }

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const page = has_more ? rows.slice(0, limit) : rows;

  const lastRow = page.at(-1);
  const nextCursor =
    has_more && lastRow
      ? encodeCursor({
          created_at: (lastRow as { created_at: string }).created_at,
          id: lastRow.id,
        })
      : null;

  void audit({
    action: "platform_admin.tenants_listed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      filters: { status: status ?? null, has_q: !!q },
      result_count: page.length,
    },
  });

  return ok(page, {
    requestId,
    meta: { has_more, cursor: nextCursor },
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/tenants
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", "Invalid request body", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { display_name, slug, legal_name, cnpj, plan, owner_email, owner_password } =
    parsed.data;
  const admin = createAdminClient();

  const { data: org, error: insertError } = await admin
    .from("organizations")
    .insert({
      display_name,
      slug,
      legal_name: legal_name ?? null,
      cnpj: cnpj ?? null,
      // A check constraint de organizations.status não tem 'onboarding' — o
      // marcador de onboarding é onboarded_at null (mesmo modelo do signup).
      status: "active",
      settings: { plan },
      created_by: adminCtx.user.id,
    })
    .select("id, slug, display_name")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return fail("conflict", "Slug already exists", 409, { requestId });
    }
    return fail("internal_error", "Failed to create tenant", 500, {
      requestId,
      details: insertError.message,
    });
  }

  // O dono, se veio senha. Depois do audit de criação da organização seria
  // tarde: quem lê a trilha veria o tenant nascer e a pessoa aparecer sem
  // ligação clara. Aqui as duas linhas saem na mesma sequência.
  let donoCriado: string | null = null;
  if (owner_password) {
    const r = await criarUsuarioNaOrganizacao({
      admin,
      organizationId: org.id,
      atorUserId: adminCtx.user.id,
      email: owner_email,
      senha: owner_password,
      // `admin` do tenant: é o dono. Sem isto ele não conseguiria nem criar o
      // resto do time, e a organização voltaria a ser inalcançável na prática.
      papel: "admin",
      requestId,
    });
    if (r.ok) {
      donoCriado = r.userId;
    } else {
      // A organização JÁ existe neste ponto, e desfazê-la para reportar erro do
      // dono seria pior: o slug ficaria livre de novo e quem opera perderia o
      // que já deu certo. Reporta o parcial, com o que falta fazer.
      logger.error("admin.tenant.dono_nao_criado", {
        organizationId: org.id,
        requestId,
        motivo: r.motivo,
      });
      return ok(
        {
          id: org.id,
          slug: org.slug,
          display_name: org.display_name,
          owner_created: false,
          aviso:
            "A organização foi criada, mas o dono não. Crie a pessoa pela aba Equipe do tenant.",
        },
        { status: 201, requestId },
      );
    }
  }

  void audit({
    action: "tenant.created_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    requestId,
    metadata: {
      slug: org.slug,
      display_name: org.display_name,
      plan,
      owner_email_hash: owner_email
        ? Buffer.from(owner_email.trim().toLowerCase())
            .toString("hex")
            .slice(0, 12) + "..."
        : null,
    },
  });

  return ok(
    {
      id: org.id,
      slug: org.slug,
      display_name: org.display_name,
      owner_created: donoCriado !== null,
    },
    { status: 201, requestId },
  );
}
