/**
 * Fragmentos → a seção do CHANGELOG que a tela da VPS mostra.
 *
 * O que este módulo protege, e que nenhuma ferramenta pronta protegeria: o
 * `CHANGELOG.md` deste produto **é tela**. `lib/system/changelog.ts` extrai a
 * seção de uma versão e a rota de sistema a entrega ao dono do servidor. Por
 * isso a saída aqui não é "um changelog bonito" — é a entrada de um parser
 * conhecido, e cada decisão de forma abaixo existe para não quebrá-lo.
 *
 * Módulo PURO. Sem disco, sem rede, sem marca: `lib/` é varrido por
 * `tests/unit/branding.test.ts`, então a URL de comparação entra por parâmetro.
 */
import type { Fragmento, Secao } from "./fragmento";

/** Exatamente o que `ATTENTION_HEADING` casa, com o U+26A0 que ela espera. */
const HEADING_ATENCAO = "### ⚠️ Requer atenção";

/**
 * O bloco de atenção vem PRIMEIRO, e isso não é estética: o agente do host
 * corta o CHANGELOG em bytes antes de mandar, e `findAttentionRange` acha o
 * bloco em qualquer posição. Na frente, o aviso sobrevive mesmo quando o corpo
 * é decapitado pelo corte.
 */
const ORDEM: readonly Secao[] = ["adicionado", "alterado", "corrigido"];

const TITULO_DA_SECAO: Record<Secao, string> = {
  adicionado: "### Adicionado",
  alterado: "### Alterado",
  corrigido: "### Corrigido",
};

/**
 * DUAS formas da mesma seção.
 *
 * - `tela` — o que vai para o `CHANGELOG.md`, que o agente da VPS corta em
 *   30.000 bytes crus (`hostgator-setup-kit/agent.sh`) antes de o app extrair a
 *   seção. Cada item sai com o título e o PRIMEIRO parágrafo do corpo (é onde o
 *   fragmento diz o efeito para o operador); `nada_mudou` sai só com o título.
 *   O aviso de atenção sai sempre inteiro.
 * - `completa` — o corpo inteiro de cada fragmento, para
 *   `docs/releases/v<versão>.md`. É onde a explicação longa continua existindo.
 *
 * Por que a forma curta virou regra de MONTAGEM e não pedido de "escreva menos":
 * medido em 2026-10-09, 107 fragmentos acumulados davam 148 KB de seção contra o
 * teto de 30 KB — a tela da VPS receberia o texto decapitado, e enxugar 107
 * notas à mão só adiaria o estouro até a próxima leva. Com a regra, o mesmo
 * conjunto cabe em cerca de um terço disso.
 */
export type FormaDaSecao = "tela" | "completa";

/** Teto do resumo de um item, em bytes. Corta só em fim de LINHA (ver `item`). */
export const LIMITE_DO_RESUMO = 240;

/**
 * O primeiro parágrafo, em linhas INTEIRAS, até `LIMITE_DO_RESUMO` bytes — a
 * primeira linha entra sempre. Cortar no meio de uma linha poderia partir um
 * `**negrito**`, que o validador só garante fechar na mesma linha.
 */
function resumo(corpo: string): string {
  const paragrafo = corpo.split(/\n\s*\n/)[0] ?? "";
  const saida: string[] = [];
  let bytes = 0;
  for (const linha of paragrafo.split("\n")) {
    const tamanho = new TextEncoder().encode(linha).length + 1;
    if (saida.length > 0 && bytes + tamanho > LIMITE_DO_RESUMO) break;
    saida.push(linha);
    bytes += tamanho;
  }
  return saida.join("\n");
}

/**
 * Um item vira `- **titulo** corpo`, com as quebras de linha do fragmento
 * PRESERVADAS e a continuação indentada em dois espaços.
 *
 * Nunca refluir: `markdownParaTextoSimples` converte `**...**` com uma regex
 * single-line, então um negrito partido entre duas linhas chega à tela com os
 * asteriscos literais.
 */
function item(f: Fragmento, forma: FormaDaSecao): string {
  if (forma === "tela" && f.impacto === "nada_mudou") return `- **${f.titulo}**`;
  const corpo = forma === "tela" ? resumo(f.corpo) : f.corpo;
  const [primeira, ...resto] = corpo.split("\n");
  const continuacao = resto.map((l) => (l.trim() === "" ? "" : `  ${l}`));
  return [`- **${f.titulo}** ${primeira ?? ""}`.trimEnd(), ...continuacao].join("\n");
}

/** Onde a forma `completa` da versão é gravada. */
export function caminhoDasNotas(versao: string): string {
  return `docs/releases/v${versao}.md`;
}

export interface SecaoMontada {
  versao: string;
  texto: string;
}

/**
 * @param data no formato `YYYY-MM-DD` — vem de fora porque o módulo é puro e
 *   porque um teste que chama `new Date()` mede o relógio, não a montagem.
 * @param forma `tela` (padrão) para o `CHANGELOG.md`; `completa` para as notas.
 */
export function montarSecao(
  fragmentos: readonly Fragmento[],
  versao: string,
  data: string,
  forma: FormaDaSecao = "tela",
): SecaoMontada {
  if (fragmentos.length === 0) {
    throw new Error("montarSecao sem fragmento: não há seção a escrever");
  }

  const partes: string[] = [`## [${versao}] — ${data}`, ""];

  // TODOS os avisos sob UM heading só. Dois headings de atenção fariam
  // `findAttentionRange` pegar o primeiro e deixar o segundo vazando para
  // dentro de "O que muda" na tela.
  const avisos = fragmentos.filter((f) => f.atencao);
  if (avisos.length > 0) {
    partes.push(HEADING_ATENCAO, "");
    for (const f of avisos) {
      partes.push(`- **${f.titulo}** ${f.atencao?.split("\n")[0] ?? ""}`.trimEnd());
      const resto = (f.atencao ?? "").split("\n").slice(1);
      for (const l of resto) partes.push(l.trim() === "" ? "" : `  ${l}`);
    }
    partes.push("");
  }

  for (const secao of ORDEM) {
    const daSecao = fragmentos.filter((f) => f.secao === secao);
    if (daSecao.length === 0) continue;
    partes.push(TITULO_DA_SECAO[secao], "");
    for (const f of daSecao) {
      partes.push(item(f, forma), "");
    }
  }

  // A forma curta diz onde mora a longa: quem quer o porquê de um item sabe
  // onde procurar, em vez de concluir que ele não tem explicação.
  if (forma === "tela") partes.push(`Notas completas desta versão: \`${caminhoDasNotas(versao)}\`.`);

  return { versao, texto: partes.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() };
}

/** `## [Não lançado]` — a âncora que a seção nova nasce logo abaixo. */
const ANCORA = /^##\s+\[Não lançado\].*$/m;

/**
 * Insere a seção montada e atualiza o rodapé de referências de link.
 *
 * O rodapé apodrece à mão, e já apodreceu: medido no HEAD b3996c43, o arquivo
 * não tem linha `[1.6.0]:` e o `[Não lançado]` ainda compara contra `v1.5.0` —
 * uma versão inteira depois. Quem escreve à mão esquece; quem monta, não.
 *
 * @param compararUrl função que devolve a URL de comparação entre duas tags.
 *   Entra por parâmetro porque este arquivo não pode nomear o repositório.
 */
export function aplicarNoChangelog(
  raw: string,
  secao: SecaoMontada,
  anterior: string,
  compararUrl: (de: string, para: string) => string,
): string {
  if (!ANCORA.test(raw)) {
    throw new Error("CHANGELOG.md sem `## [Não lançado]`: não sei onde inserir a seção");
  }

  // `replace` com FUNÇÃO, nunca com string: `$&`, `$'` e `` $` `` são
  // sequências especiais no argumento de substituição, e o texto do fragmento
  // é prosa escrita à mão que neste repo rotineiramente carrega shell e regex.
  let saida = raw.replace(ANCORA, (ancora) => `${ancora}\n\n${secao.texto}`);

  const refNova = `[${secao.versao}]: ${compararUrl(`v${anterior}`, `v${secao.versao}`)}`;
  const refNaoLancado = `[Não lançado]: ${compararUrl(`v${secao.versao}`, "HEAD")}`;

  if (/^\[Não lançado\]:\s+\S+$/m.test(saida)) {
    saida = saida.replace(/^\[Não lançado\]:\s+\S+$/m, () => `${refNaoLancado}\n${refNova}`);
  } else {
    saida = `${saida.trimEnd()}\n\n${refNaoLancado}\n${refNova}\n`;
  }

  return saida.endsWith("\n") ? saida : `${saida}\n`;
}
