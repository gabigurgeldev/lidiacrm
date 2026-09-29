/**
 * Resend wrapper. Usado por: convites de team, LGPD (export + alarme de SLA).
 *
 * ── O remetente é do OPERADOR; o nome de exibição é da MARCA ─────────────────
 *
 * `RESEND_FROM_EMAIL` é um endereço de um domínio que precisa estar VERIFICADO
 * na conta Resend de quem instalou — é do operador, e nenhuma resolução de
 * marca muda isso. O que a marca resolve é o NOME de exibição (`fromName`),
 * que é o que o destinatário lê na caixa de entrada. É aqui que o white-label
 * do remetente acontece, e é só aqui.
 *
 * ── Por que vazio significa NÃO CONFIGURADO ─────────────────────────────────
 *
 * O fallback antigo era `"Deskcomm <noreply@deskcomm.app>"`. Num clone isso é
 * PIOR que nada: o domínio não está verificado na conta Resend do revendedor,
 * então TODO envio falha lá na Resend e volta como `send_failed` com mensagem
 * opaca — o operador vai caçar rede, contêiner e chave, quando o problema é uma
 * variável em branco. Tratar como não-configurado joga o fluxo no caminho que
 * JÁ existe e JÁ é bom: `EmailNotConfigured` → `pending_review` no worker de
 * LGPD (`workers/lgpd-export-worker.ts:254-289`) e o convite mostrando o
 * `accept_url` na tela (`app/api/v1/team/invite/route.ts`).
 *
 * As duas chaves saíram do `process.env` cru e entraram no Zod (`lib/env.ts`).
 * Fora dele elas ficavam fora do `.env.example` e fora do `install.sh`, e o
 * `.env` é escrito com truncamento: chave posta à mão sumia no update seguinte.
 *
 * ── Dois transportes: SMTP vence Resend ──────────────────────────────────────
 *
 * `EMAIL_SMTP_HOST` preenchido → SMTP (Amazon SES ou qualquer servidor). É o
 * caminho de quem já manda o e-mail do login pelo SES e não quer um segundo
 * provedor só para o CRM. Sem ele, vale o Resend como antes. O nome do arquivo
 * ficou: é o ponto de entrada que todo chamador já importa.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

import { env } from "@/lib/env";

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  /**
   * Nome de exibição do remetente — a marca resolvida (`marcaDaSaida().nome`).
   * Ausente usa o endereço puro: quem não passa marca não ganha a nossa.
   */
  fromName?: string;
}

interface SendResult {
  ok: boolean;
  id?: string;
  error?: "not_configured" | "send_failed" | "rate_limited" | "dominio_nao_verificado";
  details?: string;
}

let _client: Resend | null = null;

function getClient(): Resend | null {
  if (_client) return _client;
  const key = env.RESEND_API_KEY;
  if (!key || key.length < 10) return null;
  _client = new Resend(key);
  return _client;
}

let _smtp: Transporter | null = null;

/**
 * Porta 465 é TLS desde o primeiro byte; as outras (587, 2587) começam em
 * claro e SOBEM para TLS — `requireTLS` recusa seguir sem isso, para a senha
 * nunca atravessar a rede aberta.
 */
function getSmtp(): Transporter | null {
  if (_smtp) return _smtp;
  const host = env.EMAIL_SMTP_HOST.trim();
  if (host.length === 0) return null;
  const port = env.EMAIL_SMTP_PORT;
  const user = env.EMAIL_SMTP_USER.trim();
  _smtp = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: user ? { user, pass: env.EMAIL_SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return _smtp;
}

/** Só para testes: o transporte é memoizado por processo. */
export function _resetTransportesParaTeste(): void {
  _client = null;
  _smtp = null;
}

/**
 * `null` = não há remetente utilizável. Nunca inventa um domínio nosso.
 *
 * O nome de exibição é sanitizado: `<`, `>`, `"` e quebra de linha dentro do
 * cabeçalho `From:` são injeção de cabeçalho SMTP, e a marca vem de um campo
 * que o operador digita numa tela.
 */
export function fromAddress(fromName?: string): string | null {
  const endereco = (env.EMAIL_FROM.trim() || env.RESEND_FROM_EMAIL).trim();
  if (endereco.length === 0) return null;
  const nome = (fromName ?? "").replace(/[<>"\r\n]/g, "").trim();
  return nome.length > 0 ? `${nome} <${endereco}>` : endereco;
}

/**
 * A Resend recusa domínio não verificado com uma mensagem própria, e o ramo
 * genérico `send_failed` a apagava. Classificar aqui é o que faz a diferença
 * entre "reinicie o container" e "verifique seu domínio na Resend" — a lição
 * já paga neste projeto: erro que não nomeia a causa vira caça ao fantasma.
 */
function classificar(nome: string, mensagem: string): NonNullable<SendResult["error"]> {
  if (nome.toLowerCase().includes("rate")) return "rate_limited";
  if (/not verified|domain is not verified|não verificad/i.test(mensagem)) {
    return "dominio_nao_verificado";
  }
  return "send_failed";
}

/**
 * O SES responde "Email address is not verified" tanto para remetente fora do
 * domínio verificado quanto — no modo sandbox — para DESTINATÁRIO não
 * verificado. As duas se resolvem no painel do SES, não reiniciando nada.
 */
function classificarSmtp(err: unknown): NonNullable<SendResult["error"]> {
  const e = err as { responseCode?: number; message?: string };
  const mensagem = e?.message ?? "";
  if (e?.responseCode === 454 || /throttl|rate exceeded|maximum sending rate/i.test(mensagem)) {
    return "rate_limited";
  }
  if (/not verified|não verificad/i.test(mensagem)) return "dominio_nao_verificado";
  return "send_failed";
}

async function enviarPorSmtp(smtp: Transporter, from: string, args: SendArgs): Promise<SendResult> {
  try {
    const info = await smtp.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    return {
      ok: false,
      error: classificarSmtp(err),
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const smtp = getSmtp();
  const client = smtp ? null : getClient();
  const from = fromAddress(args.fromName);

  if ((!smtp && !client) || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[email] envio desligado — falta EMAIL_SMTP_HOST ou RESEND_API_KEY, ou o remetente (EMAIL_FROM/RESEND_FROM_EMAIL). Payload:",
        {
          to: args.to,
          subject: args.subject,
          preview: args.text?.slice(0, 200) ?? args.html.slice(0, 200),
          tem_transporte: smtp !== null || client !== null,
          tem_remetente: from !== null,
        },
      );
    }
    return { ok: false, error: "not_configured" };
  }

  if (smtp) return enviarPorSmtp(smtp, from, args);
  if (!client) return { ok: false, error: "not_configured" };

  try {
    const { data, error } = await client.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
      tags: args.tags,
    });

    if (error) {
      return {
        ok: false,
        error: classificar(String(error.name || ""), error.message ?? ""),
        details: error.message,
      };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    return {
      ok: false,
      error: "send_failed",
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Chave E remetente. Só a chave não basta: com `RESEND_FROM_EMAIL` vazio todo
 * envio devolve `not_configured`, e uma tela que dissesse "e-mail configurado"
 * mandaria o operador esperar uma mensagem que nunca sai.
 */
export function isEmailConfigured(): boolean {
  return (getSmtp() !== null || getClient() !== null) && fromAddress() !== null;
}
