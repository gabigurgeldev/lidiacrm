import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GRAUS } from "@/lib/branding/rampa";

const RAIZ = process.cwd();
const CSS = fs.readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");

/**
 * Lê o bloco cujo seletor está SOZINHO na linha (`[data-theme="dark"] {`).
 *
 * Casar por `includes` pegaria `[data-theme="dark"] ::selection` e
 * `[data-theme="dark"] *` junto, e o teste compararia um bloco que não existe.
 */
function blocoDe(seletor: string): Map<string, string> {
  const linhas = CSS.split("\n");
  const inicio = linhas.findIndex((l) => l.trim() === `${seletor} {`);
  if (inicio === -1) throw new Error(`não achei o bloco \`${seletor} {\` no globals.css`);
  const decls = new Map<string, string>();
  for (let i = inicio + 1; i < linhas.length; i += 1) {
    const linha = (linhas[i] ?? "").trim();
    if (linha === "}") return decls;
    if (!linha.startsWith("--")) continue;
    const corte = linha.indexOf(":");
    decls.set(linha.slice(0, corte).trim(), linha.slice(corte + 1).replace(/;$/, "").trim());
  }
  throw new Error(`o bloco \`${seletor}\` não fecha`);
}

const RAMPA = new Set(GRAUS.map((g) => `--color-accent-${g}`));

describe("tema claro escopável em subárvore", () => {
  // Lido DENTRO de cada caso, não no corpo do describe: `blocoDe` lança quando o
  // bloco some, e um throw na coleta derruba o arquivo inteiro — a contagem cai
  // e nenhuma asserção diz o que quebrou.
  it("existe — `:root` casa só o <html>", () => {
    const claro = blocoDe('[data-theme="light"]');
    // Medido antes de escrever o bloco: `grep -c 'data-theme="light"'` = 0. Sem
    // ele, um `<div data-theme="light">` dentro de uma página escura herda os
    // tokens ESCUROS e renderiza uma tela que mente — que é exatamente o que o
    // preview lado a lado da marca faz.
    expect(claro.size).toBeGreaterThan(0);
  });

  it("espelha EXATAMENTE o que o tema escuro sobrescreve, menos a rampa", () => {
    const claro = blocoDe('[data-theme="light"]');
    const escuro = blocoDe('[data-theme="dark"]');
    // Custom property herdada não volta ao valor do `:root` dentro de uma
    // subárvore (`initial`/`revert` a deixam SEM valor), então redeclarar é
    // obrigação da linguagem. O conjunto certo é o que o escuro sobrescreve: o
    // que só existe no `:root` é herdado sem problema.
    //
    // A rampa fica de fora de propósito: as 11 paradas são idênticas nos dois
    // blocos do produto (omiti-las não muda pixel), e assim uma subárvore clara
    // herda a rampa do <html> — a do revendedor — em vez de fixar a Sage.
    const esperado = [...escuro.keys()].filter((k) => !RAMPA.has(k)).sort();
    expect([...claro.keys()].sort()).toEqual(esperado);
    for (const k of claro.keys()) expect(RAMPA.has(k), k).toBe(false);
  });

  it("cada valor espelhado é o mesmo do `:root`", () => {
    const raiz = blocoDe(":root");
    const claro = blocoDe('[data-theme="light"]');
    // Guarda de vacuidade: um espelho VAZIO passaria no laço abaixo sem nenhuma
    // asserção, e este caso viraria verde justamente quando o bloco sumisse.
    expect(claro.size).toBeGreaterThan(0);
    // A catraca da cópia: sem ela, mexer numa cor clara no `:root` deixa o
    // espelho com o valor de ontem, e o preview mostra uma paleta que não
    // existe em lugar nenhum.
    for (const [prop, valor] of claro) {
      expect(raiz.get(prop), `${prop} divergiu entre :root e [data-theme="light"]`).toBe(valor);
    }
  });

  it("o seletor do `:root` continua sozinho, sem lista", () => {
    // POR QUE ESTE TESTE EXISTE: a forma óbvia seria `:root, [data-theme="light"]`
    // num bloco só. Ela quebra `extrairRegua` (lib/branding/contraste.ts), que
    // acha o bloco claro por IGUALDADE EXATA de seletor — e com ele vão a régua
    // inteira e os testes de contraste. Quem "simplificar" o espelho para uma
    // lista precisa esbarrar aqui, não descobrir depois.
    expect(CSS).toMatch(/\n:root \{/);
    expect(CSS).not.toMatch(/\n:root\s*,/);
  });

  it("o `color-scheme` acompanha o escopo", () => {
    // Sem isto a subárvore recebe os tokens claros mas o navegador continua
    // pintando scrollbar, `<input>` e menu nativo em escuro dentro dela.
    expect(CSS).toMatch(/\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/);
  });
});

/**
 * A moldura em L — barra lateral + cabeçalho — é uma REGIÃO escura dentro de uma
 * página clara, e o escopo dela (`.casca-escura`) tem três invariantes que, se
 * quebrados, falham SEM SINTOMA VISÍVEL no lugar do erro. Daí este bloco.
 */
describe("casca escura — o escopo de token da moldura em L", () => {
  it("existe e declara `--color-bg` como PRIMEIRA linha", () => {
    const casca = blocoDe(".casca-escura");
    expect(casca.size).toBeGreaterThan(0);

    // ⚠️ ESTA É A LINHA QUE IMPEDE O BLOCO DE ENVENENAR A RÉGUA.
    // `extrairRegua` (lib/branding/contraste.ts) varre TODA regra do arquivo
    // atrás de papéis da accent. Como `.casca-escura` não contém
    // `[data-theme="dark"]` no seletor, ela cai no balde do tema CLARO — e o
    // único critério que faz a extração PULAR uma regra é ela declarar
    // `--color-bg`. Sem esta linha, cada `var(--color-accent-NNN)` do bloco
    // vira um papel novo, e a contagem de 6 papéis / 18 pares de
    // `branding-contraste.test.ts` reprova com uma mensagem que não aponta
    // para cá.
    expect(casca.has("--color-bg"), "`--color-bg` sumiu de `.casca-escura`").toBe(true);
    expect([...casca.keys()][0], "`--color-bg` deixou de ser a primeira declaração").toBe(
      "--color-bg",
    );
  });

  it("cobre EXATAMENTE o que o tema escuro sobrescreve, menos a rampa", () => {
    const casca = blocoDe(".casca-escura");
    const escuro = blocoDe('[data-theme="dark"]');
    // Mesma obrigação de linguagem do espelho claro, acima: uma custom property
    // com `var()` é substituída NO ELEMENTO em que é declarada, então
    // `--card: var(--color-surface)` declarado no `:root` desce até aqui JÁ
    // RESOLVIDO como branco. Redeclarar `--color-surface` não o atualiza — quem
    // atualiza é redeclarar `--card` também. Um alias esquecido aqui aparece
    // como um cartão BRANCO dentro da barra preta, e só nele.
    const esperado = [...escuro.keys()].filter((k) => !RAMPA.has(k)).sort();
    expect([...casca.keys()].sort()).toEqual(esperado);
    for (const k of casca.keys()) expect(RAMPA.has(k), k).toBe(false);
  });

  it("não congela NENHUM hex de accent — a cor de quem hospeda tem de chegar", () => {
    const casca = blocoDe(".casca-escura");
    for (const [prop, valor] of casca) {
      if (!prop.startsWith("--color-accent")) continue;
      // `--color-accent-fg` é literal por natureza: é a FRENTE que se lê sobre a
      // accent, e ela é preto ou branco, nunca um grau da rampa.
      if (prop === "--color-accent-fg") continue;
      // Os demais precisam apontar para a rampa, porque é o bloco injetado em
      // runtime (`:root:root`, no <html>) que troca as paradas. Um hex literal
      // aqui congelaria a NOSSA marca na instalação vendida em azul — e o
      // sintoma seria a barra lateral verde num produto inteiro azul.
      expect(valor, `${prop} precisa referenciar a rampa, não um hex`).toMatch(
        /var\(--color-accent-\d+\)|rgba\(/,
      );
    }
  });

  it("não usa `data-theme=\"dark\"` — que num <aside> não casaria nada", () => {
    // POR QUE O ESCOPO É UMA CLASSE E NÃO O ATRIBUTO DE TEMA: `lib/branding/
    // css.ts` emite `:root:root[data-theme="dark"]`, e `:root` é o <html>. Um
    // `<aside data-theme="dark">` jamais casaria essa regra, e o escopo por
    // organização (`[data-theme="dark"] body:has(…)`) tampouco — o aside é
    // DESCENDENTE do body, não ancestral. A cor configurada pela instalação
    // simplesmente não chegaria à moldura, e o gate ficaria verde.
    const casca = CSS.slice(CSS.indexOf(".casca-escura {"));
    const fim = casca.indexOf("\n}");
    expect(casca.slice(0, fim)).not.toContain("data-theme");
  });
});

describe("indicador de foco no modo de alto contraste", () => {
  it("existe um rider de forced-colors que devolve o outline", () => {
    // WCAG 2.4.7, nível A. Medido: 0 ocorrências de `forced-colors` no repo, e
    // 14 arquivos que matam `outline` desenhando o foco com `ring-*` — que é
    // `box-shadow`, e o modo de alto contraste do Windows APAGA box-shadow.
    // Nesses 14, o foco simplesmente sumia.
    const bloco = /@media \(forced-colors: active\) \{[\s\S]*?\n {2}\}/.exec(CSS)?.[0] ?? "";
    expect(bloco).toContain(":focus-visible");
    expect(bloco).toMatch(/outline:\s*2px solid Highlight\s*!important/);
    expect(bloco).toMatch(/outline-offset:\s*2px\s*!important/);
  });

  it("usa cor de sistema, não cor da paleta", () => {
    // No forced-colors o navegador SUBSTITUI as cores do autor; só as cores de
    // sistema (`Highlight`) sobrevivem. Um `var(--color-accent-500)` aqui seria
    // um rider que não pinta nada.
    const bloco = /@media \(forced-colors: active\) \{[\s\S]*?\n {2}\}/.exec(CSS)?.[0] ?? "";
    expect(bloco).not.toContain("var(--");
  });
});
