/**
 * Convite de time, em PT-BR. Devolve subject/html/text.
 *
 * É o PRIMEIRO artefato que um usuário novo recebe do sistema. A marca entra
 * resolvida (`marcaDaSaida(organizationId)`, classe A: há organização) e a casca
 * é a mesma de todo e-mail do produto (`lib/email/layout.ts`): logo no topo,
 * botão no accent derivado, neutros da régua no resto.
 */
import type { MarcaDeSaida } from "@/lib/branding/saida";

import { escapeHtml, layoutDeEmail, paragrafo } from "../layout";

export interface InviteEmailOptions {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
  role: string;
  expiresAt: Date;
  /** A marca de quem convidou. Obrigatória — sem ela o e-mail não tem dono. */
  marca: MarcaDeSaida;
}

const PAPEIS: Record<string, string> = {
  admin: "administrador",
  manager: "gestor",
  agent: "atendente",
  viewer: "leitor",
};

export function buildInviteEmail(opts: InviteEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const expiresStr = opts.expiresAt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "long",
    timeStyle: "short",
  });
  const marca = opts.marca.nome;
  const papel = PAPEIS[opts.role] ?? opts.role;
  const subject = `${opts.inviterName} convidou você para a ${opts.orgName} no ${marca}`;

  const html = layoutDeEmail({
    marca: opts.marca,
    previa: `${opts.inviterName} convidou você para entrar na equipe da ${opts.orgName}.`,
    titulo: `Você foi convidado para a ${opts.orgName}`,
    corpoHtml:
      paragrafo(
        `<strong>${escapeHtml(opts.inviterName)}</strong> convidou você para fazer parte da equipe da <strong>${escapeHtml(opts.orgName)}</strong> no ${escapeHtml(marca)}, como <strong>${escapeHtml(papel)}</strong>.`,
      ) +
      paragrafo("Clique no botão abaixo para criar seu acesso e entrar. Leva menos de um minuto."),
    botao: { texto: "Aceitar convite", url: opts.acceptUrl },
    observacaoHtml: `Este convite vale até <strong>${escapeHtml(expiresStr)}</strong>. Se você não esperava por ele, pode ignorar este e-mail com segurança.`,
    motivo: `Você recebeu este e-mail porque ${opts.inviterName} convidou este endereço para a ${opts.orgName}.`,
  });

  const text = [
    `Você foi convidado para a ${opts.orgName} como ${papel} no ${marca}.`,
    "",
    `${opts.inviterName} convidou você para a equipe.`,
    "",
    `Aceitar: ${opts.acceptUrl}`,
    "",
    `Expira em ${expiresStr}.`,
  ].join("\n");

  return { subject, html, text };
}
