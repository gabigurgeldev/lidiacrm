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

import { ramoDeExcecao, ramoPadrao, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

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

/**
 * Normaliza para E.164 (`+` seguido de 8 a 15 dígitos), que é o formato que o
 * CHECK `contacts_phone_e164_format` exige de `contacts.phone_number`.
 *
 * Aceita o que uma pessoa digita de verdade — `+55 (11) 99999-8888`,
 * `55 11 99999 8888` — porque o campo é livre e ninguém digita E.164 puro. Fora
 * da faixa devolve `null`: enviar para um número não-discável falharia lá na
 * frente, na criação do contato, com um erro de constraint que quem montou o
 * fluxo não tem como ligar ao campo que preencheu.
 *
 * Teto de tamanho ANTES do laço: a string vem de `ctx.render`, ou seja, pode
 * carregar o valor de uma variável do fluxo, que é entrada externa.
 */
export function telefoneEmE164(bruto: string): string | null {
  if (bruto.length > 64) return null;
  let digitos = "";
  for (const ch of bruto) {
    if (ch >= "0" && ch <= "9") digitos += ch;
  }
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `+${digitos}`;
}

export const notifyUserConfigSchema = z.strictObject({
  /**
   * Quem avisar. `dono_do_lead` resolve pelo dono atual; `telefone` manda para
   * um número escrito no bloco (o do gerente, o do plantão), e aceita
   * `{{vars.x}}` porque passa por `ctx.render` antes de ser normalizado.
   */
  destinatario: z
    .discriminatedUnion("tipo", [
      z.strictObject({ tipo: z.literal("dono_do_lead") }),
      z.strictObject({ tipo: z.literal("usuario"), user_id: z.string().min(1).max(120) }),
      // Sem regex aqui de propósito: o valor pode ser um template, e um `+`
      // literal só existe depois do render. Quem valida é `telefoneEmE164`, no
      // execute, e o que não passa cai no ramo "Sem telefone cadastrado".
      z.strictObject({ tipo: z.literal("telefone"), telefone: z.string().min(1).max(64) }),
    ])
    .default({ tipo: "dono_do_lead" }),
  mensagem: z.string().min(1).max(4000),
  /**
   * Por qual conexão o aviso sai. `null` = a primeira disponível.
   *
   * Nullable com default, e não obrigatório, por duas razões: quem tem UM número
   * não deveria carregar uma decisão que não tem, e todo fluxo já publicado tem
   * config sem este campo — exigi-lo faria a `strictObject` recusar o grafo de
   * quem já usa o bloco, e o fluxo pararia de rodar na atualização.
   */
  canal_id: z.string().uuid().nullable().default(null),
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
    ramoDeExcecao(RAMO_SEM_TELEFONE, "Sem telefone cadastrado"),
    ramoDeExcecao(RAMO_NAO_SAIU, "Não saiu agora"),
    ramoPadrao("Depois de avisar"),
  ],
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    // Destinatário por PESSOA: o fato daquele usuário não está em `ctx.fatos`
    // (que carrega só o dono do lead), e o nó não lê banco — então a resposta
    // vem por porta. Antes disto, este caminho devolvia `{ kind: "dead" }` e a
    // execução MORRIA em silêncio: nenhum aviso, nenhuma mensagem, nada na
    // tela. Era o pior desfecho possível num bloco cujo propósito é avisar.
    const telefone =
      config.destinatario.tipo === "usuario"
        ? await ctx.crm.telefoneDoUsuario({ userId: config.destinatario.user_id })
        : config.destinatario.tipo === "telefone"
          ? telefoneEmE164(ctx.render(config.destinatario.telefone))
          : (ctx.fatos.assigned_user?.notification_phone ?? null);

    if (telefone === null || telefone.trim() === "") {
      // Ramo próprio, e não falha: telefone em branco é configuração faltando,
      // e quem monta o fluxo precisa poder desenhar o que fazer nesse caso
      // (avisar o gerente, seguir sem avisar). Falhar esconderia a escolha.
      //
      // Mas a saída sozinha não bastava: ela é `excecao`, então pode ficar
      // SOLTA — e aí o caminho termina ali sem uma linha em lugar nenhum. Era
      // exatamente o "não avisou nada e não enviou" relatado. A Central passa a
      // registrar, sempre, que o vendedor não foi avisado.
      await avisarQueNaoSaiu(ctx, "sem_telefone", "ninguém tem telefone de aviso cadastrado");
      return { kind: "advance", branch_id: RAMO_SEM_TELEFONE };
    }

    const texto = ctx.render(config.mensagem);
    const desfecho = await ctx.canal.enviarTexto({
      telefone,
      texto,
      interno: true,
      channelSessionId: config.canal_id ?? null,
    });

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
        await avisarQueNaoSaiu(ctx, "na_fila", desfecho.motivo);
        return {
          kind: "advance",
          branch_id: RAMO_NAO_SAIU,
          vars: { aviso_na_fila_por: desfecho.motivo },
        };
      case "recusado":
        await avisarQueNaoSaiu(ctx, "recusado", desfecho.motivo);
        return { kind: "advance", branch_id: RAMO_NAO_SAIU, vars: { aviso_recusado_por: desfecho.motivo } };
    }
  },
};

/**
 * O aviso ao vendedor não saiu — e alguém precisa ficar sabendo.
 *
 * ⚠️ Isto NÃO substitui as saídas de exceção do bloco: quem quiser tratar o caso
 * no desenho continua podendo. Ele cobre o caso que era invisível — as saídas
 * são `excecao`, a publicação não cobra ligação nelas (de propósito), e uma
 * saída solta encerra o caminho sem registro. Um vendedor que não foi avisado
 * some, e o fluxo termina dizendo que deu certo.
 *
 * A severidade é `warn` e não `critical` porque não há nada quebrado no sistema:
 * é configuração faltando ou canal indisponível, e as duas se resolvem na tela.
 *
 * Nunca lança: falhar ao registrar não pode desfazer nem travar o que já
 * aconteceu. A porta de avisos já engole o erro dela, e o `catch` aqui cobre o
 * resto.
 */
async function avisarQueNaoSaiu(
  ctx: Parameters<FlowNodeDefinition<NotifyUserConfig>["execute"]>[0],
  motivoCurto: string,
  detalhe: string,
): Promise<void> {
  const lead = ctx.fatos.lead?.title ?? "sem lead";
  try {
    await ctx.avisos.abrir({
      titulo: "O aviso ao vendedor não saiu",
      corpo:
        `O bloco "${ctx.nodeId}" de um fluxo tentou avisar a equipe sobre "${lead}" e não ` +
        `conseguiu (${motivoCurto}: ${detalhe}). O vendedor NÃO foi avisado. ` +
        "Confira o telefone de aviso em Equipe › Atendimento e a conexão escolhida no bloco.",
      severidade: "warn",
      refId: ctx.executionId,
    });
  } catch {
    // Registrar é secundário ao fluxo seguir. Ver o cabeçalho.
  }
}

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
