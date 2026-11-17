/**
 * Text chunker for the RAG indexing pipeline.
 *
 * Semantic-aware: splits by paragraphs first, then by sentence boundaries
 * for oversized chunks. Applies overlap between consecutive chunks to preserve
 * cross-boundary context for retrieval.
 */

import { createHash } from "node:crypto";

export interface ChunkOptions {
  /** Maximum characters per chunk before sub-splitting. Default: 1500 */
  maxChars?: number;
  /** Characters of overlap between consecutive chunks. Default: 200 */
  overlapChars?: number;
}

/**
 * Splits `text` into overlapping chunks suitable for embedding.
 *
 * Strategy:
 *   1. Split by double-newline (paragraph boundaries).
 *   2. If any paragraph exceeds `maxChars`, sub-split by `. ` (sentence boundaries).
 *   3. Add `overlapChars` of the previous chunk's tail to the next chunk's head.
 *   4. Trim and remove empty results.
 */
export function chunkText(text: string, opts?: ChunkOptions): string[] {
  const maxChars = opts?.maxChars ?? 1500;
  const overlapChars = opts?.overlapChars ?? 200;

  // Step 1: paragraph split
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Step 2: sub-split oversized paragraphs
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      segments.push(para);
    } else {
      // Split by sentence boundaries (". " or ".\n")
      const sentences = para.split(/\.(?:\s|\n)/).filter((s) => s.trim().length > 0);
      let current = "";
      for (const sentence of sentences) {
        const candidate = current ? `${current}. ${sentence.trim()}` : sentence.trim();
        if (candidate.length > maxChars && current.length > 0) {
          segments.push(current.trim());
          current = sentence.trim();
        } else {
          current = candidate;
        }
      }
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
    }
  }

  if (segments.length === 0) return [];
  if (segments.length === 1) {
    const only = segments[0];
    return only ? [only] : [];
  }

  // Step 3: apply overlap
  const chunks: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    if (i === 0) {
      chunks.push(seg);
      continue;
    }
    const prev = chunks[chunks.length - 1] ?? "";
    const tail = prev.length > overlapChars ? prev.slice(-overlapChars) : prev;
    const chunk = `${tail}\n${seg}`.trim();
    chunks.push(chunk);
  }

  // Step 4: deduplicate and filter empties
  return chunks.filter((c) => c.length > 0);
}

/**
 * CHUNKER QUE RESPEITA A ESTRUTURA DO DOCUMENTO.
 *
 * `chunkText` corta por parágrafo e frase sem saber onde está: a seção
 * "Trocas" de um manual vira vários trechos soltos, e o trecho "em até 7 dias,
 * com nota fiscal" chega ao agente sem dizer de QUÊ é o prazo. E parágrafo curto
 * vira trecho sozinho — três linhas de uma lista viram três trechos.
 *
 * Este:
 *  1. Acompanha o caminho de títulos (markdown `#`, ou linha curta toda em
 *     maiúsculas, comum no texto extraído de PDF) e PREFIXA cada trecho com
 *     ele ("Política de trocas › Prazo"). O trecho passa a carregar o assunto.
 *  2. Mantém tabela (linhas com `|`) e lista inteiras num bloco só.
 *  3. Junta blocos pequenos da MESMA seção até o teto; nunca junta seções
 *     diferentes.
 *  4. Bloco maior que o teto cai em `chunkText` (frase + sobreposição).
 *
 * Sem título nenhum no texto, o resultado é o de juntar parágrafos até o teto —
 * nunca pior que o algoritmo antigo.
 */
export function chunkDocumento(texto: string, opts?: ChunkOptions): string[] {
  const maxChars = opts?.maxChars ?? 1500;
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");

  interface Secao {
    caminho: string[];
    blocos: string[];
  }
  type TipoDeBloco = "texto" | "tabela" | "lista";
  const secoes: Secao[] = [];
  const caminho: Array<{ nivel: number; titulo: string }> = [];
  let atual: Secao = { caminho: [], blocos: [] };
  let bloco: string[] = [];
  let tipoDoBloco: TipoDeBloco | null = null;

  const fecharBloco = () => {
    const t = bloco.join("\n").trim();
    if (t) atual.blocos.push(t);
    bloco = [];
    tipoDoBloco = null;
  };
  const abrirSecao = (nivel: number, titulo: string) => {
    fecharBloco();
    if (atual.blocos.length > 0) secoes.push(atual);
    while (caminho.length > 0 && (caminho[caminho.length - 1]?.nivel ?? 0) >= nivel) caminho.pop();
    caminho.push({ nivel, titulo });
    atual = { caminho: caminho.map((c) => c.titulo), blocos: [] };
  };

  for (const bruta of linhas) {
    const limpa = bruta.trim();
    const md = /^(#{1,6})\s+(.+?)\s*#*$/.exec(limpa);
    if (md) {
      abrirSecao((md[1] ?? "#").length, (md[2] ?? "").trim());
      continue;
    }
    if (ehTituloEmMaiusculas(limpa)) {
      // Título de PDF não tem nível: entra abaixo dos títulos markdown abertos.
      abrirSecao(7, capitalizar(limpa));
      continue;
    }
    if (limpa === "") {
      fecharBloco();
      continue;
    }
    const tipo: TipoDeBloco = limpa.startsWith("|")
      ? "tabela"
      : /^([-*•]|\d+[.)])\s+/.test(limpa)
        ? "lista"
        : "texto";
    // Linha de texto logo depois de item de lista é continuação do item.
    const continuaLista: boolean = (tipoDoBloco as TipoDeBloco | null) === "lista" && tipo === "texto";
    if (tipoDoBloco !== null && tipo !== tipoDoBloco && !continuaLista) fecharBloco();
    tipoDoBloco = continuaLista ? "lista" : tipo;
    bloco.push(limpa);
  }
  fecharBloco();
  if (atual.blocos.length > 0) secoes.push(atual);

  const trechos: string[] = [];
  for (const secao of secoes) {
    const prefixo = secao.caminho.length > 0 ? `${secao.caminho.join(" › ")}\n` : "";
    const teto = Math.max(200, maxChars - prefixo.length);
    let acumulado = "";
    const emitir = () => {
      if (acumulado.trim()) trechos.push(`${prefixo}${acumulado.trim()}`);
      acumulado = "";
    };
    for (const b of secao.blocos) {
      if (b.length > teto) {
        emitir();
        for (const pedaco of chunkText(b, { maxChars: teto, overlapChars: opts?.overlapChars ?? 200 })) {
          trechos.push(`${prefixo}${pedaco}`);
        }
        continue;
      }
      const junto = acumulado ? `${acumulado}\n\n${b}` : b;
      if (junto.length > teto) {
        emitir();
        acumulado = b;
      } else {
        acumulado = junto;
      }
    }
    emitir();
  }
  return trechos;
}

/** Linha curta, com letra, toda em maiúsculas e sem pontuação final de frase. */
function ehTituloEmMaiusculas(linha: string): boolean {
  if (linha.length < 3 || linha.length > 80) return false;
  if (linha.startsWith("|")) return false;
  if (linha !== linha.toUpperCase()) return false;
  if (/[.;,:]$/.test(linha)) return false;
  // Ao menos uma palavra de 3+ letras — "R$ 10" ou "A1" não são título.
  return /[A-ZÀ-Ý]{3,}/.test(linha);
}

function capitalizar(linha: string): string {
  const minusculas = linha.toLowerCase();
  return minusculas.charAt(0).toUpperCase() + minusculas.slice(1);
}

/**
 * Computes a SHA-256 hex digest of `content` for change detection / dedup.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
