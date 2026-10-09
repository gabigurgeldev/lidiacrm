/**
 * PDF text extractor for the RAG ingestion pipeline.
 *
 * UMA engine: pdfjs-dist (build `legacy`, que é a que roda em Node).
 * Uma tentativa só. Se ela falhar, lança PdfExtractError — não há segunda.
 *
 * Este arquivo já teve duas tentativas (pdf-parse como primária, pdfjs como
 * fallback) e elas NÃO eram duas engines. O pdf-parse@1 vendoriza quatro cópias
 * completas do pdf.js da Mozilla dentro de si — 29 dos 29 MB do pacote estão em
 * `lib/` — e fixa a `v1.10.100`, de 2018. Ou seja: era o MESMO pdf.js duas vezes,
 * com 7 majors de distância, e a cópia velha rodava PRIMEIRO.
 *
 * Medido na issue #238: a v1.10.100 falha com "bad XRef entry" na própria fixture
 * deste repo (`tests/fixtures/sample-text.pdf`) e com "Illegal character: 41" num
 * PDF gerado pelo @react-pdf/renderer. A "primária" já estava morta há tempos e
 * quem extraía era o fallback — o teste verde media o caminho de baixo achando que
 * media o de cima. Redundância que não é redundante é código morto, e este arquivo
 * já pagou por isso uma vez (issue #102, comentado em `pdf-texto.mjs`).
 *
 * A regra de extração mora em `pdf-texto.mjs` (JS puro). Este arquivo só escolhe
 * ONDE ela roda — no mesmo processo ou num `node` filho — e traduz o desfecho.
 */


import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { DesfechoDoPdf } from "./pdf-texto.mjs";

export class PdfExtractError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PdfExtractError";
  }
}

/** Teto de tempo do processo filho: PDF que trava a engine não trava o worker. */
const TEMPO_MAXIMO_DO_FILHO_MS = 60_000;
/** Teto de heap do filho — ~14 MB medidos por PDF; folga para PDF grande. */
const HEAP_DO_FILHO_MB = 256;

const SCRIPT_DO_FILHO = join(process.cwd(), "lib/ai/rag/extractors/pdf-processo-isolado.mjs");

/**
 * Isola quando o processo atual roda sob o loader do `tsx` — a condição medida em
 * que o pdf.js custa 255 MB de heap em vez de 14 MB (cabeçalho de `pdf-texto.mjs`).
 * O worker de produção roda assim (`Dockerfile.worker`); o app Next, compilado, não.
 * `PDF_EXTRACAO_ISOLADA=1|0` força um lado (diagnóstico e testes).
 */
export function deveIsolarExtracao(): boolean {
  const forcado = process.env.PDF_EXTRACAO_ISOLADA;
  if (forcado === "1") return true;
  if (forcado === "0") return false;
  const sobTsx = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/)].some((a) =>
    /[\/]tsx[\/]/.test(a),
  );
  return sobTsx && existsSync(SCRIPT_DO_FILHO);
}

/**
 * Extrai texto puro de um buffer de PDF usando pdfjs-dist.
 * Lança `PdfExtractError` se o arquivo for ilegível ou não tiver texto algum.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const desfecho = deveIsolarExtracao()
    ? await extrairEmProcessoFilho(buffer)
    : await (await import("./pdf-texto.mjs")).extrairTextoDoPdf(new Uint8Array(buffer));
  return traduzir(desfecho);
}

function traduzir(desfecho: DesfechoDoPdf): string {
  if (desfecho.ok) return desfecho.texto;
  if (desfecho.tipo === "sem_texto") throw new PdfExtractError(desfecho.mensagem);

  // Sem esta mensagem, quem instalou vê "DOMMatrix is not defined" e não tem como
  // ligar isso a uma dependência que ele nem sabe que existe. O diagnóstico custa
  // 4 linhas; a caçada custa uma tarde.
  if (desfecho.tipo === "canvas") {
    throw new PdfExtractError(
      "Extração de PDF indisponível: o binário nativo @napi-rs/canvas não foi instalado " +
        "nesta plataforma. Reinstale as dependências SEM podar as opcionais " +
        "(`pnpm install`, não `--no-optional`). Até lá, PDFs não são lidos.",
      new Error(desfecho.mensagem),
    );
  }
  throw new PdfExtractError("pdfjs-dist failed to extract text from the PDF", new Error(desfecho.mensagem));
}

function extrairEmProcessoFilho(buffer: Buffer): Promise<DesfechoDoPdf> {
  return new Promise((resolve) => {
    // `process.execPath` sem `execArgv`: o filho NÃO herda o loader do `tsx`. O
    // NODE_OPTIONS também sai, pelo mesmo motivo — é por ali que o loader viaja.
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const filho = spawn(process.execPath, [`--max-old-space-size=${HEAP_DO_FILHO_MB}`, SCRIPT_DO_FILHO], {
      env,
      stdio: ["pipe", "pipe", "ignore"],
    });

    let saida = "";
    let resolvido = false;
    const concluir = (d: DesfechoDoPdf) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(relogio);
      resolve(d);
    };
    const relogio = setTimeout(() => {
      filho.kill("SIGKILL");
      concluir({ ok: false, tipo: "falha", mensagem: `extração excedeu ${TEMPO_MAXIMO_DO_FILHO_MS} ms` });
    }, TEMPO_MAXIMO_DO_FILHO_MS);

    filho.stdout.setEncoding("utf8");
    filho.stdout.on("data", (pedaco: string) => (saida += pedaco));
    filho.on("error", (err) => concluir({ ok: false, tipo: "falha", mensagem: err.message }));
    filho.on("close", (codigo, sinal) => {
      // O pdf.js escreve avisos ("Warning: ...") no stdout: o desfecho é a ÚLTIMA linha.
      const ultima = saida.trim().split("\n").pop() ?? "";
      try {
        concluir(JSON.parse(ultima) as DesfechoDoPdf);
      } catch {
        concluir({
          ok: false,
          tipo: "falha",
          mensagem: `processo de extração terminou sem desfecho (código ${codigo}, sinal ${sinal})`,
        });
      }
    });
    filho.stdin.on("error", () => {}); // filho que morre cedo fecha o pipe; o `close` decide
    filho.stdin.end(buffer);
  });
}
