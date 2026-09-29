/**
 * GET   /api/v1/settings/aniversario — a configuração da mensagem de aniversário
 *       + os aniversariantes de hoje e dos próximos 7 dias + os últimos envios.
 * PATCH /api/v1/settings/aniversario — grava a configuração (manager+).
 *
 * Mesmo desenho de `settings/routing`: gate por papel resolvido de fonte
 * confiável, escrita com admin client (a policy de `organizations` só deixa
 * super-admin escrever pela sessão — ver o comentário longo lá), merge que
 * preserva as outras chaves de `settings`, e `organization_id` sempre explícito.
 *
 * Ao LIGAR, a rota confere o que o cron vai precisar às 9h da manhã sem ninguém
 * olhando: a conexão existe, não foi excluída, o modo bate com ela, e — na API
 * oficial — o modelo está aprovado com as variáveis preenchidas. Descobrir isso
 * na hora do envio viraria aviso na Central e aniversariante sem mensagem.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { diaLocal, proximosDias } from "@/lib/aniversario/datas";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { recusaDeModo } from "@/lib/bulk-send/modo";
import { ARCHIVED_AT, consultaTolerante, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import type { ChannelProvider } from "@/lib/channels/capabilities";
import { conferirDefinicao } from "@/lib/channels/conferir-definicao";
import { lerConfigDeAniversario, salvarAniversarioSchema } from "@/lib/schemas/aniversario";
import { validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DIAS_NO_PAINEL = 8; // hoje + 7

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_aniversario" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const { data: orgRow, error } = await admin
    .from("organizations")
    .select("settings, timezone")
    .eq("id", orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const config = lerConfigDeAniversario(orgRow?.settings);
  const hoje = diaLocal(new Date(), (orgRow?.timezone as string | null) ?? null);
  const dias = proximosDias(hoje, DIAS_NO_PAINEL);

  // Uma consulta só para os 8 dias; a separação por dia acontece aqui.
  const todosMmdd = [...new Set(dias.flatMap((d) => d.mmdd))];
  const [{ data: aniversariantes }, { count: comData }, { data: envios }] = await Promise.all([
    admin.rpc("fn_aniversariantes_do_dia", { p_org: orgId, p_mmdd: todosMmdd }),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("birthdate", "is", null),
    admin
      .from("aniversario_envios")
      .select("data_local, total, bulk_send_id")
      .eq("organization_id", orgId)
      .order("data_local", { ascending: false })
      .limit(10),
  ]);

  const lista = ((aniversariantes ?? []) as { contact_id: string; nome: string | null; birthdate: string }[]).map(
    (a) => ({ ...a, mmdd: a.birthdate.slice(5, 10) }),
  );
  const proximos = dias.map((d) => ({
    data: d.data,
    contatos: lista
      .filter((a) => d.mmdd.includes(a.mmdd))
      .map((a) => ({ id: a.contact_id, nome: a.nome ?? "Sem nome", nascimento: a.birthdate })),
  }));

  return ok(
    { config, hoje: hoje.data, proximos, contatos_com_data: comData ?? 0, envios: envios ?? [] },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_aniversario" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  let input;
  try {
    input = await validateRequest(salvarAniversarioSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const admin = createAdminClient();

  if (input.ativo && input.canal_id && input.modo) {
    const recusa = await conferirConexao(admin, orgId, input.canal_id, input.modo);
    if (recusa) return fail("validation_failed", recusa, 422, { requestId });
    if (input.modo === "template" && input.modelo) {
      try {
        await conferirDefinicao(admin, {
          organizationId: orgId,
          channelSessionId: input.canal_id,
          name: input.modelo.nome,
          language: input.modelo.idioma,
          values: input.modelo.valores,
        });
      } catch (err) {
        return fail(
          "validation_failed",
          err instanceof Error ? err.message : "O modelo escolhido não pôde ser conferido.",
          422,
          { requestId },
        );
      }
    }
  }

  const { data: orgRow, error: readErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (readErr) return fail("internal_error", readErr.message, 500, { requestId });

  const atual = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  const antes = lerConfigDeAniversario(atual);
  const { error: updErr } = await admin
    .from("organizations")
    .update({ settings: { ...atual, aniversario: input } })
    .eq("id", orgId);
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  void audit({
    action: "aniversario.config_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: {
      ativo: input.ativo,
      ligou: !antes.ativo && input.ativo,
      desligou: antes.ativo && !input.ativo,
      canal_id: input.canal_id,
      modo: input.modo,
      hora: input.hora,
    },
  });

  return ok(input, { requestId });
}

/** `null` = conexão utilizável no modo pedido; senão, a frase para a tela. */
async function conferirConexao(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  canalId: string,
  modo: "freeform" | "template",
): Promise<string | null> {
  const select = (comModo: boolean, comArchived: boolean) =>
    `id, provider${comModo ? ", provider_mode" : ""}${comArchived ? `, ${ARCHIVED_AT}` : ""}`;
  const buscar = (comModo: boolean) => () =>
    queryTolerantToMissingArchived(
      () => admin.from("channel_sessions").select(select(comModo, true)).eq("id", canalId).eq("organization_id", orgId).maybeSingle(),
      () => admin.from("channel_sessions").select(select(comModo, false)).eq("id", canalId).eq("organization_id", orgId).maybeSingle(),
    );
  const { data } = await consultaTolerante("provider_mode", buscar(true), buscar(false));
  const sessao = data as unknown as
    | { provider: ChannelProvider; provider_mode?: string | null; archived_at?: string | null }
    | null;
  if (!sessao) return "Conexão não encontrada. Escolha outra.";
  if (sessao.archived_at) return "Essa conexão foi excluída da Central de Conexões. Escolha outra.";
  return recusaDeModo({ provider: sessao.provider, mode: sessao.provider_mode ?? null }, modo);
}
