/**
 * LGPD export email delivery (Resend).
 *
 * NEVER logs the recipient address in plaintext (CLAUDE.md §LGPD L-08).
 * Only sha256(email) appears in logs/audit metadata.
 *
 * ── Este e-mail diz quem OPEROU; o PDF diz quem RESPONDE ────────────────────
 *
 * Aqui a marca resolvida é a resposta certa: o e-mail informa que a solicitação
 * foi PROCESSADA, e no produto de um revendedor quem processa é o sistema dele.
 * O relatório em anexo faz o oposto de propósito — nomeia o CONTROLADOR
 * (`organizations.legal_name`) e nenhuma marca, porque ali o que está em jogo é
 * quem responde legalmente pelos dados (ver `lib/lgpd/pdf-renderer.tsx`).
 *
 * São dois papéis diferentes, e é por isso que as duas saídas carregam nomes
 * diferentes. Sem esta frase escrita, a próxima pessoa "uniformiza" os dois e
 * refaz o defeito — numa direção ou na outra.
 *
 * Antes desta fase o nome vinha de `args.organizationName ?? "DeskcommCRM"`, e
 * isso NÃO era borda: o único chamador (`workers/lgpd-export-worker.ts`) nunca
 * passava o campo, então 100% dos e-mails de LGPD de todo clone diziam que a
 * solicitação tinha sido processada pelo DeskcommCRM. O campo agora é
 * obrigatório e resolvido — não sobra fallback porque `marcaDaSaida` já desce
 * até o padrão do produto por conta própria.
 */

import { createHash } from "node:crypto";

import type { MarcaDeSaida } from "@/lib/branding/saida";
import { escapeHtml, layoutDeEmail, paragrafo } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/resend";

export class EmailNotConfigured extends Error {
  constructor() {
    super("RESEND_API_KEY missing or invalid");
    this.name = "EmailNotConfigured";
  }
}

export class EmailSendFailed extends Error {
  constructor(detail: string) {
    super(`Resend send failed: ${detail}`);
    this.name = "EmailSendFailed";
  }
}

export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

interface SendArgs {
  to: string;
  requestId: string;
  signedUrl: string;
  expiresAt: Date;
  /** A marca de quem PROCESSOU a solicitação. Obrigatória — ver o cabeçalho. */
  marca: MarcaDeSaida;
}

export async function sendExportEmail(args: SendArgs): Promise<{ messageId: string }> {
  const shortId = args.requestId.slice(0, 8);
  const orgName = escapeHtml(args.marca.nome);
  const expiresFmt = args.expiresAt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const subject = `Sua solicitação LGPD #${shortId}`;

  const html = layoutDeEmail({
    marca: args.marca,
    previa: `Seu relatório de dados pessoais está pronto para download.`,
    titulo: `Solicitação LGPD #${shortId} processada`,
    corpoHtml:
      paragrafo("Olá,") +
      paragrafo(
        `Sua solicitação de acesso aos dados pessoais (LGPD Art. 18, II) foi processada por <strong>${orgName}</strong>.`,
      ) +
      paragrafo(
        `O relatório completo está disponível no botão abaixo. Por segurança, o link expira em <strong>${escapeHtml(expiresFmt)}</strong>.`,
      ),
    botao: { texto: "Baixar relatório LGPD", url: args.signedUrl },
    observacaoHtml:
      "Se você não solicitou este relatório, ignore este e-mail — nenhum dado adicional é compartilhado.<br>Base legal: LGPD Lei nº 13.709/2018, Art. 18, II.",
    motivo: "Você recebeu este e-mail porque fez uma solicitação de acesso aos seus dados pessoais.",
  });

  // O corpo em texto puro NÃO passa por `escapeHtml` — escapar aqui mostraria
  // `&amp;` ao titular numa marca como "Silva &amp; Filhos".
  const text = `Solicitação LGPD #${shortId} processada por ${args.marca.nome}.

O relatório completo está disponível em:
${args.signedUrl}

O link expira em ${expiresFmt}.

Se você não solicitou este relatório, ignore este email.
Base legal: LGPD Lei nº 13.709/2018, Art. 18, II.`;

  const result = await sendEmail({
    to: args.to,
    subject,
    html,
    text,
    fromName: args.marca.nome,
    tags: [
      { name: "kind", value: "lgpd_export" },
      { name: "request_short", value: shortId },
    ],
  });

  if (!result.ok) {
    if (result.error === "not_configured") {
      throw new EmailNotConfigured();
    }
    throw new EmailSendFailed(result.details ?? result.error ?? "unknown");
  }

  return { messageId: result.id ?? "unknown" };
}
