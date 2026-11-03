import { Fragment, type ReactNode } from "react";

/**
 * Markdown MÍNIMO para as respostas da assistente: parágrafos, listas
 * (`-`, `*`, `1.`), títulos (`#` vira negrito), **negrito**, *itálico* e
 * `código`. É o que o prompt pede ao modelo, e nada além.
 *
 * Sem `dangerouslySetInnerHTML` e sem biblioteca: a resposta é texto de modelo,
 * e um modelo enganado por injeção poderia devolver `<img onerror>`. Aqui todo
 * texto vira nó de texto do React — HTML na resposta aparece como texto.
 * Links também não viram `<a>`: a assistente não manda ninguém para fora.
 */
export function renderizarMarkdown(texto: string): ReactNode {
  const blocos: ReactNode[] = [];
  let lista: { ordenada: boolean; itens: string[] } | null = null;
  let paragrafo: string[] = [];

  const fecharParagrafo = () => {
    if (paragrafo.length === 0) return;
    blocos.push(
      <p key={`p${blocos.length}`} className="whitespace-pre-wrap">
        {inline(paragrafo.join("\n"))}
      </p>,
    );
    paragrafo = [];
  };
  const fecharLista = () => {
    if (!lista) return;
    const Tag = lista.ordenada ? "ol" : "ul";
    blocos.push(
      <Tag
        key={`l${blocos.length}`}
        className={lista.ordenada ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}
      >
        {lista.itens.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    lista = null;
  };

  for (const linhaBruta of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linha = linhaBruta.trimEnd();
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(linha);
    const titulo = /^\s*#{1,6}\s+(.*)$/.exec(linha);

    if (item) {
      fecharParagrafo();
      const ordenada = item[2] !== undefined;
      if (lista && lista.ordenada !== ordenada) fecharLista();
      lista ??= { ordenada, itens: [] };
      lista.itens.push(item[3] ?? "");
    } else if (titulo) {
      fecharParagrafo();
      fecharLista();
      blocos.push(
        <p key={`h${blocos.length}`} className="font-semibold">
          {inline(titulo[1] ?? "")}
        </p>,
      );
    } else if (linha.trim() === "") {
      fecharParagrafo();
      fecharLista();
    } else {
      fecharLista();
      paragrafo.push(linha);
    }
  }
  fecharParagrafo();
  fecharLista();
  return <div className="space-y-2">{blocos}</div>;
}

/** `**negrito**`, `*itálico*`/`_itálico_` e `` `código` ``, sem aninhamento. */
function inline(texto: string): ReactNode {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g);
  return partes.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    if (((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) && p.length > 2)
      return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
