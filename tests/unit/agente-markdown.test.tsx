import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderizarMarkdown } from "@/components/agente/markdown";

/**
 * A resposta da assistente é texto de modelo. Se uma injeção a fizer devolver
 * HTML, ele tem de aparecer como TEXTO, nunca virar elemento.
 */
describe("markdown da assistente", () => {
  it("HTML na resposta sai escapado", () => {
    const html = renderToStaticMarkup(<>{renderizarMarkdown('<img src=x onerror="alert(1)"> e <script>x</script>')}</>);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
  });

  it("negrito, código, listas numeradas e com marcador", () => {
    const html = renderToStaticMarkup(
      <>{renderizarMarkdown("Abra **Canais › Conexões**:\n\n1. Clique em `Conectar`\n2. Leia o QR\n\n- dica")}</>,
    );
    expect(html).toContain("<strong>Canais › Conexões</strong>");
    expect(html).toContain("<code");
    expect(html).toMatch(/<ol[^>]*><li>Clique em <code[^>]*>Conectar<\/code><\/li><li>Leia o QR<\/li><\/ol>/);
    expect(html).toMatch(/<ul[^>]*><li>dica<\/li><\/ul>/);
  });

  it("link em markdown não vira <a>", () => {
    const html = renderToStaticMarkup(<>{renderizarMarkdown("[clique](https://evil.example)")}</>);
    expect(html).not.toContain("<a");
  });
});
