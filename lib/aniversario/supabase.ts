/**
 * As dependências reais do motor de aniversário (`motor.ts`), sobre o Supabase.
 *
 * Service role em tudo, com `organization_id` SEMPRE filtrado à mão: o
 * `orgId` vem da linha de `organizations` lida aqui mesmo, nunca de entrada
 * externa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarDisparo } from "@/lib/bulk-send/criar-disparo";
import { logger } from "@/lib/logger";
import { lerConfigDeAniversario } from "@/lib/schemas/aniversario";

import type { AniversarioDeps, OrgComAniversario, ResultadoDaCriacao } from "./motor";

export function depsDeAniversario(
  admin: SupabaseClient,
  extra: Pick<AniversarioDeps, "podeOperar"> = {},
): AniversarioDeps {
  return {
    ...extra,

    async orgsComAniversarioLigado(): Promise<OrgComAniversario[]> {
      const { data, error } = await admin
        .from("organizations")
        .select("id, timezone, settings")
        .eq("settings->aniversario->>ativo", "true")
        // Suspensa, redigida (LGPD) ou arquivada não fala com cliente nenhum.
        .eq("status", "active");
      if (error) throw new Error(`aniversario: leitura das organizações falhou: ${error.message}`);
      return ((data ?? []) as { id: string; timezone: string | null; settings: unknown }[]).map((o) => ({ id: o.id, timezone: o.timezone, config: lerConfigDeAniversario(o.settings) }));
    },

    async reservarDia(orgId, dataLocal) {
      const { error } = await admin
        .from("aniversario_envios")
        .insert({ organization_id: orgId, data_local: dataLocal });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`aniversario: reserva do dia falhou: ${error.message}`);
    },

    async liberarDia(orgId, dataLocal) {
      await admin
        .from("aniversario_envios")
        .delete()
        .eq("organization_id", orgId)
        .eq("data_local", dataLocal)
        .is("bulk_send_id", null);
    },

    async concluirDia(orgId, dataLocal, r) {
      await admin
        .from("aniversario_envios")
        .update({ bulk_send_id: r.bulkSendId, total: r.total })
        .eq("organization_id", orgId)
        .eq("data_local", dataLocal);
    },

    async aniversariantes(orgId, mmdd) {
      const { data, error } = await admin.rpc("fn_aniversariantes_do_dia", { p_org: orgId, p_mmdd: mmdd });
      if (error) throw new Error(`aniversario: busca dos aniversariantes falhou: ${error.message}`);
      return ((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
    },

    async criarDisparo(org, nome, contactIds): Promise<ResultadoDaCriacao> {
      const cfg = org.config;
      const r = await criarDisparo(
        admin,
        { organizationId: org.id, autor: { tipo: "automacao" } },
        {
          name: nome,
          channel_session_id: cfg.canal_id ?? "",
          mode: cfg.modo ?? "freeform",
          body: cfg.modo === "freeform" ? cfg.mensagem : undefined,
          template_name: cfg.modo === "template" ? cfg.modelo?.nome : undefined,
          template_language: cfg.modo === "template" ? cfg.modelo?.idioma : undefined,
          template_values: cfg.modo === "template" ? (cfg.modelo?.valores ?? {}) : {},
          interval_ms: 5_000,
          audiencia: { kind: "contacts", contact_ids: contactIds },
        },
      );
      if (!r.ok) {
        if (r.recusa.codigo === "sem_destinatario") return { ok: false, semDestinatario: true };
        return { ok: false, motivo: r.recusa.mensagem };
      }

      // Começa JÁ: o mesmo estado que o "disparar agora" da tela grava
      // (`app/api/v1/bulk-sends/[id]/start`) e que `fn_claim_due_bulk_sends`
      // reclama. `scheduled` deixaria a campanha parada à espera de um promotor
      // que só age sobre agendamento futuro.
      const agora = new Date().toISOString();
      const { error } = await admin
        .from("bulk_sends")
        .update({
          status: "running",
          scheduled_for: null,
          next_send_at: agora,
          started_at: agora,
          pause_reason: null,
          pause_detail: null,
        })
        .eq("id", r.disparoId)
        .eq("organization_id", org.id);
      if (error) {
        logger.warn("[aniversario] disparo criado, mas nao consegui iniciar", {
          organization_id: org.id,
          disparoId: r.disparoId,
          erro: error.message,
        });
      }
      return { ok: true, disparoId: r.disparoId, vaoReceber: r.recorte.vaoReceber };
    },

    async avisar(orgId, motivo) {
      // Um aviso por organização por dia, no máximo: a próxima hora tenta de
      // novo, e cada tentativa abrir um aviso enterraria a Central.
      const inicioDoDia = new Date(Date.now() - 20 * 3_600_000).toISOString();
      const titulo = "A mensagem de aniversário de hoje não saiu";
      const { data: ja } = await admin
        .from("agent_inbox_items")
        .select("id")
        .eq("organization_id", orgId)
        .eq("kind", "message_send_stuck")
        .eq("title", titulo)
        .gte("created_at", inicioDoDia)
        .limit(1);
      if (ja && ja.length > 0) return;
      const { error } = await admin.from("agent_inbox_items").insert({
        organization_id: orgId,
        kind: "message_send_stuck",
        severity: "critical",
        title: titulo,
        body:
          `Não consegui montar o envio dos aniversariantes de hoje: ${motivo} ` +
          "Confira em Configurações › Aniversários a conexão e a mensagem escolhidas. O sistema tenta de novo a cada hora até o fim do dia.",
      });
      if (error) {
        logger.error("[aniversario] aviso nao entrou na Central", { organization_id: orgId, erro: error.message });
      }
    },
  };
}
