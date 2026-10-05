/**
 * O e-mail com o código de verificação que o cliente digita no WhatsApp.
 *
 * Leva a marca da organização que ATENDE (quem conversa com o cliente), nunca
 * a do sistema consultado. E diz QUAL número de WhatsApp pediu o código — é o
 * que separa este e-mail de um golpe: quem recebe sem ter pedido sabe que não
 * deve repassar o código a ninguém, e quem pediu reconhece o próprio número.
 */
import type { MarcaDeSaida } from "@/lib/branding/saida";
import { escapeHtml, layoutDeEmail, paragrafo } from "@/lib/email/layout";

export function finalDoTelefone(telefone: string | null): string {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : "";
}

export function assuntoDoCodigo(marca: MarcaDeSaida): string {
  return `Seu código de verificação — ${marca.nome}`;
}

export function emailDoCodigo(input: {
  marca: MarcaDeSaida;
  codigo: string;
  telefoneDoContato: string | null;
  baseDoApp?: string | null;
}): { html: string; text: string } {
  const { marca, codigo } = input;
  const nome = escapeHtml(marca.nome);
  const final = finalDoTelefone(input.telefoneDoContato);
  const deOnde = final
    ? `pela conversa de WhatsApp do número terminado em <strong>${final}</strong>`
    : "por uma conversa de WhatsApp";

  const html = layoutDeEmail({
    marca,
    baseDoApp: input.baseDoApp,
    previa: `Seu código para o atendimento do ${marca.nome}.`,
    titulo: "Seu código de verificação",
    corpoHtml:
      paragrafo(
        `O atendimento do <strong>${nome}</strong> pediu este código ${deOnde}, para confirmar que a conta é sua antes de consultar ou corrigir qualquer coisa nela.`,
      ) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px"><tr><td align="center" style="background:#f4f5f4;border:1px dashed ${marca.accent};border-radius:12px;padding:18px 12px;font-size:32px;font-weight:800;letter-spacing:0.3em;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(codigo)}</td></tr></table>` +
      paragrafo("Digite o código <strong>na mesma conversa do WhatsApp</strong>. Ele vale 10 minutos."),
    observacaoHtml:
      "Se você não está falando com o nosso atendimento agora, ignore este e-mail e não repasse o código a ninguém — sem ele, ninguém acessa a sua conta.",
    motivo: `Você recebeu este e-mail porque este endereço foi informado como e-mail da conta numa conversa com o atendimento do ${marca.nome}.`,
  });

  const text =
    `Seu código de verificação: ${codigo}\n\n` +
    `O atendimento do ${marca.nome} pediu este código ${final ? `pela conversa de WhatsApp do número terminado em ${final}` : "por uma conversa de WhatsApp"}. ` +
    `Digite-o na mesma conversa. Vale 10 minutos.\n\n` +
    `Se você não está falando com o nosso atendimento agora, ignore este e-mail e não repasse o código.`;

  return { html, text };
}
