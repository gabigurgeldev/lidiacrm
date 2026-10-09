// Núcleo da extração de texto de PDF — JavaScript puro, de propósito.
//
// Duas portas usam este arquivo, e ele é a ÚNICA cópia da regra:
//   - `pdf.ts` (no mesmo processo, quando o código já está compilado — o app Next);
//   - `pdf-processo-isolado.mjs` (num `node` filho, quando quem chama roda sob `tsx`).
//
// Ele é .mjs, e não .ts, porque o processo filho existe justamente para NÃO passar
// pelo `tsx`. Medido em 2026-10-08: abrir um PDF de 9 KB sob o loader do `tsx` leva
// o heap de 9 MB a 255 MB (o loader transforma os 3,4 MB do pdf.js), enquanto o
// mesmo PDF em `node` puro fica em 14 MB. O worker de produção roda sob `tsx` com
// ~256 MB de heap, e cada PDF recebido no WhatsApp o derrubava por OOM.

/**
 * Extrai o texto de um PDF com pdfjs-dist.
 * Resolve `{ ok: true, texto }` ou `{ ok: false, tipo, mensagem }` — nunca lança,
 * para que as duas portas traduzam o desfecho do MESMO jeito.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ ok: true, texto: string } | { ok: false, tipo: "sem_texto" | "canvas" | "falha", mensagem: string }>}
 */
export async function extrairTextoDoPdf(bytes) {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // NÃO mexa em GlobalWorkerOptions.workerSrc aqui (issue #102): em Node o
    // pdf.js já se auto-configura, e `workerSrc = ""` tornava a extração
    // inalcançável. Histórico completo no cabeçalho de `pdf.ts`.
    const pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;

    const pageTexts = [];
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const content = await page.getTextContent();
      // Quebra de linha pelo `hasEOL` do pdf.js, não pelo Y do `transform` (issue #238).
      const pageText = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .trim();
      if (pageText.length > 0) pageTexts.push(pageText);
    }

    const texto = pageTexts.join("\n\n").trim();
    if (texto.length === 0) {
      return {
        ok: false,
        tipo: "sem_texto",
        mensagem: "pdfjs-dist extracted no text (possibly image-only PDF)",
      };
    }
    return { ok: true, texto };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    // O pdfjs 6 estoura no import sem o binário @napi-rs/canvas (polyfill do DOMMatrix).
    if (/DOMMatrix|@napi-rs\/canvas/.test(mensagem)) return { ok: false, tipo: "canvas", mensagem };
    return { ok: false, tipo: "falha", mensagem };
  }
}
