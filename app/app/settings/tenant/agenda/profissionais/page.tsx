import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { ProfissionaisClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * PROFISSIONAIS DA AGENDA — quem atende, em que horários, quando folga e o que
 * faz (migration 0245).
 *
 * ─── Por que uma tela nova, e não mais uma coluna em Equipe ──────────────
 *
 * Até a 0245, quem atendia era sempre um MEMBRO com login, e a jornada morava
 * em Equipe › Atendimento. O dono do produto pediu o caso que aquilo não
 * cobria: a esteticista que não usa o sistema, cadastrada pela recepção, com
 * agenda, cor e serviços próprios — e sem ocupar vaga de usuário. Equipe é
 * sobre CONTAS; isto é sobre AGENDA. Pôr profissional sem login numa tela de
 * contas seria a primeira linha de Equipe que não é uma conta.
 *
 * Quem TEM login aparece aqui também (o backfill da 0245 cria a profissional de
 * todo membro que já atendia), e a jornada dele continua sendo a mesma de
 * Equipe › Atendimento — editar aqui ou lá grava no mesmo lugar.
 */
export default async function ProfissionaisDaAgendaPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // `viewer` vê (é informação de operação: quem atende o quê). Cadastrar e
  // alterar é `manager`, e a rota cobra de novo — esconder aqui é cortesia, não
  // autorização. A folga da própria pessoa é a exceção, e quem a decide é a rota.
  const podeEditar = user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const supabase = await createClient();
  const [{ data: membros }, { data: tipos }] = await Promise.all([
    supabase
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null),
    supabase
      .from("calendar_event_types")
      .select("id, name, is_active")
      .eq("organization_id", activeOrg.orgId)
      .order("is_active", { ascending: false })
      .order("name"),
  ]);

  // O NOME, nunca o fragmento de UUID — mesma razão da tela de tipos. Sem
  // service role a função devolve vazio e o fallback é o começo do id.
  const ids = (membros ?? []).map((m) => String(m.user_id));
  const nomes = await nomesDosAtendentes(ids);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Profissionais da agenda")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {t(
              "Quem atende, em que horários, quando folga e quais serviços faz. Não precisa ter login: a profissional sem conta tem agenda e cor como qualquer outra.",
            )}
          </p>
        </div>
        <Link
          href="/app/settings/tenant/agenda"
          className="shrink-0 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {t("Tipos de agendamento")}
        </Link>
      </header>
      <ProfissionaisClient
        podeEditar={podeEditar}
        usuarioAtualId={user.id}
        membros={ids.map((id) => ({ id, nome: nomes.get(id) ?? id.slice(0, 8) }))}
        tipos={(tipos ?? []).map((tp) => ({ id: tp.id, nome: tp.name, ativo: tp.is_active }))}
      />
    </div>
  );
}
