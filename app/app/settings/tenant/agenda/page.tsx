import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { TiposDeAgendamentoClient, type TipoRow } from "./_client";

export const dynamic = "force-dynamic";

/**
 * TIPOS DE AGENDAMENTO — a configuração que o produto prometia e não tinha.
 *
 * ─── Por que aqui, e não dentro da Agenda ────────────────────────────────
 *
 * O comentário do `lib/navigation/registry.ts` já dizia, antes de esta tela
 * existir: *"Os TIPOS de agendamento e a disponibilidade — que são configuração
 * de verdade — vão para Configurações quando existirem."* A Agenda é onde o dia
 * ACONTECE; aqui é onde ele se configura.
 *
 * ─── O que estava faltando ───────────────────────────────────────────────
 *
 * A `calendar_event_types` tem dez categorias no CHECK, duração, buffers,
 * antecedência mínima, janela de agendamento e local — e não havia como criar ou
 * editar um tipo por lugar nenhum. Toda organização recebia três tipos semeados
 * (`fn_semear_tipos_de_agendamento`) e ficava com eles para sempre; uma clínica
 * que quisesse "Retorno de 15 minutos" não tinha caminho.
 */
export default async function TiposDeAgendamentoPage() {
  const user = await requireAuth();
  // `t` local em vez do hook: esta página é componente de SERVIDOR, e lá o
  // idioma vem resolvido em `user.idioma` (a cadeia pessoa → organização →
  // padrão vive em `lib/auth/server.ts`).
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // `viewer` vê a lista (é informação de operação: quanto dura uma consulta);
  // criar e alterar é `manager`, e a rota cobra de novo — a tela esconder não é
  // autorização, é cortesia.
  const podeEditar = user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const supabase = await createClient();
  const [{ data: tipos }, { data: pessoas }, { data: profissionais }, { data: habilitacoes }] = await Promise.all([
    supabase
      .from("calendar_event_types")
      .select(
        "id, name, slug, description, category, duration_minutes, location_kind, location_details, default_owner_user_id, requires_confirmation, is_active, professionals_required, slot_interval_minutes, reminder_enabled, reminder_minutes_before",
      )
      .eq("organization_id", activeOrg.orgId)
      .order("is_active", { ascending: false })
      .order("name"),
    supabase
      .from("user_organizations")
      .select("user_id, role")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null),
    // QUEM FAZ cada serviço (0245): as profissionais e a habilitação de cada
    // tipo. Lidas aqui, como os tipos — a tela se refaz por `router.refresh()`.
    supabase
      .from("calendar_professionals")
      .select("id, name, is_active")
      .eq("organization_id", activeOrg.orgId)
      .order("position")
      .order("name"),
    supabase
      .from("calendar_event_type_professionals")
      .select("event_type_id, professional_id")
      .eq("organization_id", activeOrg.orgId),
  ]);

  const habilitadas = new Map<string, string[]>();
  for (const h of habilitacoes ?? []) {
    habilitadas.set(h.event_type_id, [...(habilitadas.get(h.event_type_id) ?? []), h.professional_id]);
  }

  // O NOME DE GENTE, e não o fragmento de UUID.
  //
  // O seletor de "quem atende" oferecia `0c4f9a1e · admin` — a página lia só
  // `user_id, role` e nunca resolvia nome. Escolher responsável entre pedaços de
  // identificador não é escolha: é adivinhação, e o dono do produto tinha de
  // acertar qual dos fragmentos era ele.
  //
  // `nomesDosAtendentes` expõe SÓ `full_name`, de propósito. Não trocar por
  // `/api/v1/team`, que devolve e-mail e último acesso — PII a mais numa tela de
  // configuração que não precisa dela.
  //
  // Numa VPS sem `SUPABASE_SERVICE_ROLE_KEY` ele devolve Map vazio por decisão
  // declarada, e o fallback abaixo volta ao rótulo de hoje. Degrada, não some.
  const nomes = await nomesDosAtendentes((pessoas ?? []).map((p) => String(p.user_id)));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Tipos de agendamento")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("O que se pode marcar, quanto dura e quem atende. É isto que a tela de marcar e o agente de IA oferecem ao cliente.")}
          </p>
        </div>
        {/* A porta para QUEM atende: habilitar alguém aqui pressupõe que ela já
            esteja cadastrada lá, e a tela não pode mandar a pessoa adivinhar. */}
        <Link
          href="/app/settings/tenant/agenda/profissionais"
          data-testid="ir-para-profissionais"
          className="shrink-0 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {t("Profissionais e jornadas")}
        </Link>
      </header>
      <TiposDeAgendamentoClient
        tiposIniciais={(tipos ?? []).map(
          (tipo): TipoRow => ({ ...(tipo as Omit<TipoRow, "professional_ids">), professional_ids: habilitadas.get(tipo.id) ?? [] }),
        )}
        profissionais={(profissionais ?? []).map((p) => ({ id: p.id, nome: p.name, ativo: p.is_active }))}
        pessoas={(pessoas ?? []).map((p) => ({
          id: String(p.user_id),
          papel: String(p.role),
          nome:
            nomes.get(String(p.user_id)) ?? `${String(p.user_id).slice(0, 8)} · ${String(p.role)}`,
        }))}
        usuarioAtualId={user.id}
        podeEditar={podeEditar}
      />
    </div>
  );
}
