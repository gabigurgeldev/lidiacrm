/**
 * A casca ÚNICA de todo e-mail que o sistema manda — do CRM e do login.
 *
 * Antes dela cada e-mail tinha o próprio HTML, a própria cópia de
 * `escapeHtml` e o próprio jeito de (não) desenhar a marca: o convite tinha
 * logo, o de LGPD não, os do login eram o texto cru do Supabase. Quem recebe
 * três e-mails do mesmo produto via três produtos.
 *
 * ── Por que tabela e estilo inline ───────────────────────────────────────────
 *
 * Cliente de e-mail não é navegador. Outlook desktop renderiza com o motor do
 * Word (sem flex, sem grid, sem `max-width` em `div`), e o Gmail descarta
 * `<style>` em boa parte dos casos. Tabela com largura fixa e estilo inline é
 * o único layout que aparece igual nos dois.
 *
 * ── O logo precisa ser URL ABSOLUTA ──────────────────────────────────────────
 *
 * `marcaDaSaida()` devolve o logo padrão do produto como `/gestalt-crm.png` —
 * certo para as telas, que resolvem o caminho contra o próprio site, e errado
 * num e-mail, onde não há site: o cliente desenharia imagem quebrada no topo do
 * primeiro e-mail que a pessoa recebe. `logoDoEmail()` prefixa o endereço
 * público do app; sem endereço válido, o topo mostra o NOME da marca em texto,
 * nunca um espaço vazio.
 */
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";
import { env } from "@/lib/env";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Endereço público do app, sem barra no fim. `null` se não for http(s). */
export function urlPublicaDoApp(bruta: string = env.NEXT_PUBLIC_APP_URL): string | null {
  const url = (bruta ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+/i.test(url) ? url : null;
}

/**
 * O logo que um e-mail consegue carregar, ou `null` (e aí o topo leva o nome).
 * Caminho relativo vira absoluto contra o app; qualquer outra coisa que não
 * seja http(s) é descartada.
 */
export function logoDoEmail(
  logoUrl: string | null,
  base: string | null = urlPublicaDoApp(),
): string | null {
  const bruto = (logoUrl ?? "").trim();
  if (bruto.length === 0) return null;
  if (/^https?:\/\//i.test(bruto)) return bruto;
  if (bruto.startsWith("/") && !bruto.startsWith("//") && base) return `${base}${bruto}`;
  return null;
}

export type BotaoDoEmail = { texto: string; url: string };

export type OpcoesDoLayout = {
  marca: MarcaDeSaida;
  /** Texto curto que o cliente mostra ao lado do assunto, antes de abrir. */
  previa: string;
  titulo: string;
  /** Parágrafos já em HTML (o chamador escapa o que vier de usuário). */
  corpoHtml: string;
  botao?: BotaoDoEmail;
  /** Linha(s) finais, antes do rodapé — prazo do link, "se não foi você…". */
  observacaoHtml?: string;
  /** Por que a pessoa recebeu. Vai no rodapé, em cinza. */
  motivo: string;
  /** Cor do destaque (botão). Padrão: o accent da marca. */
  destaque?: { fundo: string; frente: string };
  /**
   * `false` quando `botao.url` é uma variável de template (`{{ .X }}`) que não
   * pode passar por `escapeHtml` — os e-mails do login. Padrão: escapa.
   */
  escaparUrlDoBotao?: boolean;
  /** Endereço base para o logo relativo — injetável nos testes. */
  baseDoApp?: string | null;
};

const FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function layoutDeEmail(o: OpcoesDoLayout): string {
  const n = NEUTROS_DE_SAIDA;
  const base = o.baseDoApp === undefined ? urlPublicaDoApp() : o.baseDoApp;
  const logo = logoDoEmail(o.marca.logoUrl, base);
  const nome = escapeHtml(o.marca.nome);
  const fundoBotao = o.destaque?.fundo ?? o.marca.accent;
  const frenteBotao = o.destaque?.frente ?? o.marca.accentFg;
  const urlBotao = o.botao
    ? o.escaparUrlDoBotao === false
      ? o.botao.url
      : escapeHtml(o.botao.url)
    : "";

  // O logo abre o cartão, centralizado — é a primeira coisa que o olho acha e o
  // que diz de quem é o e-mail antes de qualquer palavra.
  const topo = logo
    ? `<img src="${escapeHtml(logo)}" alt="${nome}" height="40" style="height:40px;width:auto;max-width:220px;border:0;display:inline-block;outline:none;text-decoration:none">`
    : `<span style="font-family:${FONTE};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${n.texto}">${nome}</span>`;

  // Botão "à prova de cliente": a cor vai no `td` (Outlook ignora o fundo do
  // `a`) E no `a` (Gmail no celular ignora o do `td` em alguns casos). Centrado,
  // largo, fácil de acertar com o polegar.
  const botao = o.botao
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:32px auto 0">
        <tr><td align="center" bgcolor="${fundoBotao}" style="border-radius:12px;background:${fundoBotao}">
          <a href="${urlBotao}" target="_blank" class="botao" style="display:inline-block;padding:16px 40px;font-family:${FONTE};font-size:16px;font-weight:700;line-height:1;color:${frenteBotao};background:${fundoBotao};text-decoration:none;border-radius:12px">${escapeHtml(o.botao.texto)}</a>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0">
        <tr><td bgcolor="${n.fundo}" style="background:${n.fundo};border-radius:10px;padding:14px 16px;font-family:${FONTE};font-size:12px;line-height:1.6;color:${n.suave}">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br>
          <a href="${urlBotao}" target="_blank" style="color:${n.texto};word-break:break-all;text-decoration:underline">${urlBotao}</a>
        </td></tr>
      </table>`
    : "";

  const observacao = o.observacaoHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0">
        <tr><td style="border-left:3px solid ${o.marca.accent};padding:2px 0 2px 14px;font-family:${FONTE};font-size:13px;line-height:1.6;color:${n.suave}">${o.observacaoHtml}</td></tr>
      </table>`
    : "";

  const site = base
    ? `<a href="${escapeHtml(base)}" target="_blank" style="color:${n.suave};text-decoration:underline">${escapeHtml(base.replace(/^https?:\/\//, ""))}</a>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(o.titulo)}</title>
<style>
  @media (max-width:600px) {
    .cartao-conteudo { padding:28px 22px 32px !important; }
    .cartao-topo { padding:28px 22px 4px !important; }
    .titulo { font-size:22px !important; }
    .botao { display:block !important; padding:16px 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${n.fundo};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(o.previa)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${n.fundo}" style="background:${n.fundo}">
  <tr><td align="center" style="padding:40px 12px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
      <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${n.linha};border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04),0 8px 24px rgba(16,24,40,0.06)">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td height="6" bgcolor="${o.marca.accent}" style="height:6px;line-height:6px;font-size:0;background:${o.marca.accent}">&nbsp;</td></tr>
          <tr><td align="center" class="cartao-topo" style="padding:36px 40px 4px">${topo}</td></tr>
          <tr><td class="cartao-conteudo" style="padding:28px 40px 40px;font-family:${FONTE};color:${n.texto}">
            <h1 class="titulo" style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${n.texto};text-align:center">${escapeHtml(o.titulo)}</h1>
            <div style="font-size:16px;line-height:1.7;color:${n.texto}">${o.corpoHtml}</div>
            ${botao}
            ${observacao}
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:28px 24px 0;font-family:${FONTE};font-size:12px;line-height:1.7;color:${n.suave}">
        <strong style="color:${n.texto};font-weight:700">${nome}</strong>${site ? ` · ${site}` : ""}<br>
        ${escapeHtml(o.motivo)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Parágrafo do corpo, com o espaçamento da casca. `html` já escapado. */
export function paragrafo(html: string): string {
  return `<p style="margin:0 0 16px">${html}</p>`;
}
