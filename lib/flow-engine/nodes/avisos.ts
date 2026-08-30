/**
 * Flow Engine — nós que avisam gente: o vendedor no WhatsApp, e a equipe na
 * Central de avisos.
 *
 * ⚠️ O nó de WhatsApp NÃO fala com o adapter. Ele usa `ctx.canal`, que por trás
 * é `sendMessageHandler` — o mesmo caminho do CRM e do agente. Um atalho pelo
 * adapter pularia bloqueio do contato, janela do número e pacing anti-banimento,
 * e a conta desse atalho é o número de WhatsApp da empresa ser banido.
 */

import { z } from "zod";

import { ramoPadrao, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

// ────────────────────────── crm.assign_owner ─────────────────────────────────

export const assignOwnerConfigSchema = z.strictObject({
  /** Id de usuário fixo, ou `{{vars.dono_escolhido}}` vindo do rodízio. */
  user_id: z.string().min(1).max(120),
});
export type AssignOwnerConfig = z.infer<typeof assignOwnerConfigSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const crmAssignOwner: FlowNodeDefinition<AssignOwnerConfig> = {
  type: "crm.assign_owner",
  version: 1,
  category: "crm",
  rotulo: "Definir o dono do lead",
  mutaCrm: true,
  descricao: "Entrega o lead a uma pessoa específica.",
  configSchema: assignOwnerConfigSchema,
  branches: () => [ramoPadrao("Depois de definir")],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const lead = ctx.fatos.lead;
    if (lead === null) return { kind: "dead", reason: "sem_lead_para_atribuir" };
    const userId = ctx.render(config.user_id).trim();
    // Recusa ANTES de escrever. Um `{{vars.dono_escolhido}}` que não resolveu
    // chega aqui como string vazia, e gravar isso deixaria o lead com dono
    // inválido — pior que não atribuir, porque some da fila de não-atribuídos.
    if (!UUID.test(userId)) {
      return { kind: "dead", reason: `dono_invalido:${userId === "" ? "vazio" : "nao_e_id"}` };
    }
    await ctx.crm.atribuirDono({ leadId: lead.id, userId });
    return {
      kind: "advance",
      branch_id: "else",
      vars: { atribuido_em: ctx.agora().toISOString() },
    };
  },
};

// ───────────────────────── whatsapp.notify_user ──────────────────────────────

const RAMO_SEM_TELEFONE = "sem_telefone";
const RAMO_NAO_SAIU = "nao_saiu";

export const notifyUserConfigSchema = z.strictObject({
  /**
   * Quem avisar. `dono_do_lead` resolve pelo dono atual; um id fixo avisa
   * sempre a mesma pessoa (o gerente, por exemplo).
   */
  destinatario: z
    .discriminatedUnion("tipo", [
      z.strictObject({ tipo: z.literal("dono_do_lead") }),
      z.strictObject({ tipo: z.literal("usuario"), user_id: z.string().min(1).max(120) }),
    ])
    .default({ tipo: "dono_do_lead" }),
  mensagem: z.string().min(1).max(4000),
});
export type NotifyUserConfig = z.infer<typeof notifyUserConfigSchema>;

export const whatsappNotifyUser: FlowNodeDefinition<NotifyUserConfig> = {
  type: "whatsapp.notify_user",
  version: 1,
  category: "whatsapp",
  rotulo: "Avisar o vendedor no WhatsApp",
  descricao: "Manda uma mensagem para o WhatsApp de quem atende, com os dados do lead.",
  configSchema: notifyUserConfigSchema,
  branches: (): ReturnType<FlowNodeDefinition["branches"]> => [
    { id: RAMO_SEM_TELEFONE, label: "Sem telefone cadastrado", kind: "match" },
    { id: RAMO_NAO_SAIU, label: "Não saiu agora", kind: "match" },
    ramoPadrao("Depois de avisar"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const telefone =
      config.destinatario.tipo === "dono_do_lead"
        ? ctx.fatos.assigned_user?.notification_phone ?? null
        : null;

    // Destinatário fixo ainda não resolve telefone: o fato do usuário nomeado
    // não está em `ctx.fatos`, e buscar aqui dentro violaria a regra de o nó
    // não falar com o banco. Fica declarado em vez de fingir que funciona —
    // expor um caminho que não envia é pior que não expor.
    if (config.destinatario.tipo === "usuario") {
      return { kind: "dead", reason: "destinatario_fixo_ainda_nao_suportado" };
    }

    if (telefone === null || telefone.trim() === "") {
      // Ramo próprio, e não falha: telefone em branco é configuração faltando,
      // e quem monta o fluxo precisa poder desenhar o que fazer nesse caso
      // (avisar o gerente, seguir sem avisar). Falhar esconderia a escolha.
      return { kind: "advance", branch_id: RAMO_SEM_TELEFONE };
    }

    const texto = ctx.render(config.mensagem);
    const desfecho = await ctx.canal.enviarTexto({ telefone, texto, interno: true });

    switch (desfecho.kind) {
      case "enviado":
        return {
          kind: "advance",
          branch_id: "else",
          vars: { aviso_enviado_em: ctx.agora().toISOString() },
        };
      case "na_fila":
        // Ficou na fila do CRM (fora de janela, número parado). NÃO é sucesso e
        // NÃO é erro: o desfecho vem do ESTADO da mensagem, nunca da ausência de
        // exceção — a lição que `lib/automation/desfecho-do-envio.ts` já pagou.
        return {
          kind: "advance",
          branch_id: RAMO_NAO_SAIU,
          vars: { aviso_na_fila_por: desfecho.motivo },
        };
      case "recusado":
        return { kind: "advance", branch_id: RAMO_NAO_SAIU, vars: { aviso_recusado_por: desfecho.motivo } };
    }
  },
};

// ─────────────────────────── notify.internal ─────────────────────────────────

export const notifyInternalConfigSchema = z.strictObject({
  titulo: z.string().min(1).max(120),
  corpo: z.string().min(1).max(1000),
  severidade: z.enum(["info", "warn", "critical"]).default("warn"),
});
export type NotifyInternalConfig = z.infer<typeof notifyInternalConfigSchema>;

export const notifyInternal: FlowNodeDefinition<NotifyInternalConfig> = {
  type: "notify.internal",
  version: 1,
  category: "notify",
  rotulo: "Abrir aviso na Central",
  descricao: "Registra um aviso na Central para quem administra ver e resolver.",
  configSchema: notifyInternalConfigSchema,
  branches: () => [ramoPadrao("Depois de avisar")],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    await ctx.avisos.abrir({
      titulo: ctx.render(config.titulo),
      corpo: ctx.render(config.corpo),
      severidade: config.severidade,
      refId: ctx.executionId,
    });
    return { kind: "advance", branch_id: "else" };
  },
};
