/**
 * TIPOS DE AGENDAMENTO — criar, alterar e desativar pela API.
 *
 * ─── O buraco que esta rota fecha ────────────────────────────────────────
 *
 * A tabela `calendar_event_types` tem dez categorias no CHECK
 * (`consulta`, `procedimento`, `retorno`, `visita`, `vistoria`, `reuniao`,
 * `call`, `orcamento`, `demonstracao`, `outro`), duração, buffers, antecedência
 * mínima, janela de agendamento e local — e **não havia como criar ou editar um
 * tipo por lugar nenhum**: nem rota, nem tela. Uma organização recebia três
 * tipos semeados e ficava com eles para sempre.
 *
 * ─── Desativar, nunca apagar ─────────────────────────────────────────────
 *
 * `calendar_appointments.event_type_id` aponta para cá. Apagar o tipo levaria
 * junto a história — que consulta foi feita, de que tipo, quanto durava. O
 * DELETE aqui grava `is_active = false`: some da tela de marcar e continua
 * respondendo pelo passado. É o mesmo raciocínio do anti-pattern 7 da doutrina
 * (cascade fantasma).
 *
 * ─── Quem atende (migration 0245) ────────────────────────────────────────
 *
 * `professionals_required` (1 ou 2: principal + apoio) e `professional_ids`, o
 * conjunto de profissionais HABILITADAS no tipo (`calendar_event_type_professionals`).
 * `professional_ids` SUBSTITUI o conjunto inteiro. Gravar `default_owner_user_id`
 * garante que o membro tem profissional e que ela está habilitada — senão o dono
 * padrão de um tipo novo não apareceria na oferta de horários.
 *
 *   GET    → os tipos, cada um com `professional_ids: uuid[]`
 *   POST   campos + `professional_ids?` → 201 `{ id, slug }`
 *   PATCH  `{ id, ...campos?, is_active?, professional_ids? }` → `{ id }`
 *   DELETE `{ id }` → `{ id }` (desativa)
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { garantirProfissionalDoMembro, MembroForaDaOrganizacaoError } from "@/lib/agenda/profissionais";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** As dez do CHECK da tabela. Fora daqui o Postgres recusa — melhor recusar antes. */
const CATEGORIAS = [
  "consulta", "procedimento", "retorno", "visita", "vistoria",
  "reuniao", "call", "orcamento", "demonstracao", "outro",
] as const;

const LOCAIS = ["in_person", "phone", "whatsapp", "video_link", "google_meet"] as const;

/**
 * Os limites são os MESMOS do CHECK do banco, e isso é deliberado.
 *
 * Zod aqui não substitui a constraint: ela é a verdade e continua valendo para
 * quem escrever por SQL. O que a validação faz é transformar um 500 de constraint
 * — que aparece como "erro interno" para quem está usando — numa recusa 422 que
 * diz o que está fora.
 */
const camposDoTipo = {
  name: z.string().trim().min(2).max(80),
  category: z.enum(CATEGORIAS),
  duration_minutes: z.number().int().min(5).max(1440),
  location_kind: z.enum(LOCAIS),
  description: z.string().trim().max(500).nullish(),
  location_details: z.string().trim().max(300).nullish(),
  default_owner_user_id: z.string().uuid().nullish(),
  requires_confirmation: z.boolean().optional(),
  buffer_before_minutes: z.number().int().min(0).max(720).optional(),
  buffer_after_minutes: z.number().int().min(0).max(720).optional(),
  minimum_notice_minutes: z.number().int().min(0).max(43_200).optional(),
  booking_window_days: z.number().int().min(1).max(365).optional(),
  /** 1 = uma profissional atende; 2 = principal + apoio (CHECK `calendar_event_types_profissionais_sensato`). */
  professionals_required: z.number().int().min(1).max(2).optional(),
  /** De quanto em quanto a grade oferece horário; `null` = a duração do tipo. */
  slot_interval_minutes: z.number().int().min(5).max(1440).nullish(),
  reminder_enabled: z.boolean().optional(),
  reminder_minutes_before: z.number().int().min(0).max(43_200).optional(),
  /** As profissionais habilitadas — SUBSTITUI o conjunto. Não é coluna do tipo. */
  professional_ids: z.array(z.string().uuid()).max(200).optional(),
};

const criarSchema = z.object(camposDoTipo);
// `.partial()` em vez de repetir os campos como opcionais: repetir criaria
// duas listas para manter em sincronia, e a segunda envelhece calada.
//
// `is_active` entra só aqui: reativar é PATCH (desativar é o DELETE). A tela de
// configurações já mandava `{ id, is_active: true }`, e sem o campo no schema o
// Zod o descartava e a rota respondia "Nenhum campo para alterar".
const alterarSchema = criarSchema.partial().extend({ id: z.string().uuid(), is_active: z.boolean().optional() });
const desativarSchema = z.object({ id: z.string().uuid() });

/**
 * O slug sai do NOME, e é estável depois de criado.
 *
 * A ferramenta MCP aceita `event_type_slug`, então o slug é endereço público: se
 * ele mudasse ao renomear o tipo, todo playbook e toda automação que o citam
 * parariam de achar — em silêncio, porque a busca por slug devolve "não existe"
 * e não "mudou de nome". Por isso o PATCH nunca o toca.
 */
function slugDe(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tipo";
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const autorizado = await requireRole("viewer", { requestId, resource: "calendar_event_types" });
  if (!autorizado.ok) return autorizado.response;

  const admin = createAdminClient();
  const org = autorizado.org.orgId;
  const { data, error } = await admin
    .from("calendar_event_types")
    .select(
      "id, name, slug, description, category, duration_minutes, location_kind, location_details, default_owner_user_id, requires_confirmation, is_active, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, booking_window_days, professionals_required, slot_interval_minutes, reminder_enabled, reminder_minutes_before",
    )
    .eq("organization_id", org)
    .order("is_active", { ascending: false })
    .order("name");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const { data: habilitacoes, error: erroHab } = await admin
    .from("calendar_event_type_professionals")
    .select("event_type_id, professional_id")
    .eq("organization_id", org);
  if (erroHab) return fail("internal_error", erroHab.message, 500, { requestId });

  const porTipo = new Map<string, string[]>();
  for (const h of (habilitacoes ?? []) as { event_type_id: string; professional_id: string }[]) {
    porTipo.set(h.event_type_id, [...(porTipo.get(h.event_type_id) ?? []), h.professional_id]);
  }

  return ok(
    (data ?? []).map((t) => ({ ...t, professional_ids: (porTipo.get(t.id) ?? []).sort() })),
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const autorizado = await requireRole("manager", { requestId, resource: "calendar_event_types" });
  if (!autorizado.ok) return autorizado.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  }

  const admin = createAdminClient();
  const org = autorizado.org.orgId;
  const { professional_ids: habilitadas, ...colunas } = lido.data;

  // Recusa ANTES de criar: um tipo que nasce sem as profissionais pedidas é um
  // "criei" sobre metade do pedido.
  const recusa = await exigeProfissionaisDaOrg(admin, org, habilitadas);
  if (recusa) return fail(recusa.codigo, recusa.motivo, recusa.status, { requestId });

  const { data, error } = await admin
    .from("calendar_event_types")
    .insert({ ...colunas, organization_id: org, slug: slugDe(lido.data.name) })
    .select("id, slug")
    .single();

  if (error) {
    // 23505 é o slug repetido — recusa esperada, não erro de sistema.
    if (error.code === "23505") {
      return fail("conflict", `Já existe um tipo com o nome "${lido.data.name}".`, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const habilitar = await habilitacaoDoTipo(admin, org, data.id, {
    substituir: habilitadas,
    donoPadrao: colunas.default_owner_user_id ?? null,
  });
  if (!habilitar.ok) return fail(habilitar.codigo, habilitar.motivo, habilitar.status, { requestId });

  await audit({
    action: "agenda.tipo_criado",
    actorUserId: autorizado.user.id,
    organizationId: org,
    resourceType: "calendar_event_types",
    resourceId: data.id,
    metadata: {
      nome: lido.data.name,
      categoria: lido.data.category,
      duracao: lido.data.duration_minutes,
      professionals_required: colunas.professionals_required ?? 1,
      professional_ids: habilitar.ids,
    },
  });
  return ok(data, { requestId, status: 201 });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const autorizado = await requireRole("manager", { requestId, resource: "calendar_event_types" });
  if (!autorizado.ok) return autorizado.response;

  const lido = alterarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  }
  const { id, professional_ids: habilitadas, ...campos } = lido.data;
  if (Object.keys(campos).length === 0 && habilitadas === undefined) {
    // Recusa em vez de UPDATE vazio: "alterei" sobre nada é a mesma família de
    // mentira que o "Marcado ✓" sem linha no banco.
    return fail("validation_failed", "Nenhum campo para alterar.", 422, { requestId });
  }

  const admin = createAdminClient();
  const org = autorizado.org.orgId;

  const recusa = await exigeProfissionaisDaOrg(admin, org, habilitadas);
  if (recusa) return fail(recusa.codigo, recusa.motivo, recusa.status, { requestId });

  // Sem coluna para mudar (só a habilitação), não há UPDATE — mas o tipo tem de
  // existir NESTA organização, senão 404 como antes.
  const { data, error } =
    Object.keys(campos).length > 0
      ? await admin
          .from("calendar_event_types")
          .update(campos)
          .eq("id", id)
          .eq("organization_id", org)
          .select("id")
          .maybeSingle()
      : await admin
          .from("calendar_event_types")
          .select("id")
          .eq("id", id)
          .eq("organization_id", org)
          .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Tipo de agendamento não encontrado.", 404, { requestId });

  const habilitar = await habilitacaoDoTipo(admin, org, id, {
    substituir: habilitadas,
    donoPadrao: campos.default_owner_user_id ?? null,
  });
  if (!habilitar.ok) return fail(habilitar.codigo, habilitar.motivo, habilitar.status, { requestId });

  await audit({
    action: "agenda.tipo_alterado",
    actorUserId: autorizado.user.id,
    organizationId: org,
    resourceType: "calendar_event_types",
    resourceId: id,
    metadata: {
      campos: [...Object.keys(campos), ...(habilitadas !== undefined ? ["professional_ids"] : [])],
      ...(habilitadas !== undefined || campos.default_owner_user_id ? { professional_ids: habilitar.ids } : {}),
    },
  });
  return ok(data, { requestId });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const autorizado = await requireRole("manager", { requestId, resource: "calendar_event_types" });
  if (!autorizado.ok) return autorizado.response;

  const lido = desativarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", "corpo inválido", 422, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_event_types")
    .update({ is_active: false })
    .eq("id", lido.data.id)
    .eq("organization_id", autorizado.org.orgId)
    .select("id")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Tipo de agendamento não encontrado.", 404, { requestId });

  await audit({
    action: "agenda.tipo_desativado",
    actorUserId: autorizado.user.id,
    organizationId: autorizado.org.orgId,
    resourceType: "calendar_event_types",
    resourceId: lido.data.id,
    metadata: {},
  });
  return ok(data, { requestId });
}

type Admin = ReturnType<typeof createAdminClient>;
type Recusa = { status: number; codigo: string; motivo: string };

/** Toda profissional pedida é desta organização? Sem dizer de quem é o id que não bateu. */
async function exigeProfissionaisDaOrg(
  admin: Admin,
  org: string,
  ids: string[] | undefined,
): Promise<Recusa | null> {
  const unicos = [...new Set(ids ?? [])];
  if (unicos.length === 0) return null;
  const { data, error } = await admin
    .from("calendar_professionals")
    .select("id")
    .eq("organization_id", org)
    .in("id", unicos);
  if (error) return { status: 500, codigo: "internal_error", motivo: error.message };
  if ((data ?? []).length === unicos.length) return null;
  return {
    status: 422,
    codigo: "agenda_profissional_invalido",
    motivo: "Alguma das profissionais informadas não existe nesta organização.",
  };
}

/**
 * Grava quem está habilitada no tipo.
 *
 *  · `substituir` presente → o conjunto vira EXATAMENTE este (mais o dono padrão,
 *    se veio nesta mesma escrita);
 *  · `donoPadrao` presente → o membro ganha profissional (se não tinha) e é
 *    ACRESCENTADO ao conjunto — gravar o dono padrão não tira ninguém.
 *
 * Acrescenta antes de tirar, para o tipo nunca ficar sem habilitada no meio do
 * caminho (o que tiraria todos os horários dele da oferta).
 */
async function habilitacaoDoTipo(
  admin: Admin,
  org: string,
  eventTypeId: string,
  args: { substituir: string[] | undefined; donoPadrao: string | null },
): Promise<({ ok: true; ids: string[] }) | ({ ok: false } & Recusa)> {
  if (args.substituir === undefined && !args.donoPadrao) return { ok: true, ids: [] };

  const ids = new Set(args.substituir ?? []);
  if (args.donoPadrao) {
    try {
      ids.add(await garantirProfissionalDoMembro(admin, org, args.donoPadrao));
    } catch (err) {
      if (err instanceof MembroForaDaOrganizacaoError) {
        return {
          ok: false,
          status: 422,
          codigo: "agenda_profissional_invalido",
          motivo: "O responsável padrão não é membro ativo desta organização.",
        };
      }
      return { ok: false, status: 500, codigo: "internal_error", motivo: (err as Error).message };
    }
  }
  const lista = [...ids].sort();

  if (lista.length > 0) {
    const { error } = await admin.from("calendar_event_type_professionals").upsert(
      lista.map((professional_id) => ({ organization_id: org, event_type_id: eventTypeId, professional_id })),
      { onConflict: "event_type_id,professional_id", ignoreDuplicates: true },
    );
    if (error) return { ok: false, status: 500, codigo: "internal_error", motivo: error.message };
  }

  if (args.substituir !== undefined) {
    let apaga = admin
      .from("calendar_event_type_professionals")
      .delete()
      .eq("organization_id", org)
      .eq("event_type_id", eventTypeId);
    if (lista.length > 0) apaga = apaga.not("professional_id", "in", `(${lista.join(",")})`);
    const { error } = await apaga;
    if (error) return { ok: false, status: 500, codigo: "internal_error", motivo: error.message };
  }

  return { ok: true, ids: lista };
}
