import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PISOS, derivarMarca, extrairRegua, razaoDeContraste } from "@/lib/branding/contraste";
import type { Regua } from "@/lib/branding/contraste";

/**
 * O cartão de vidro das telas de acesso é legível sobre QUALQUER cena.
 *
 * ── O problema, e por que ele não se resolve medindo a tela ──────────────────
 *
 * O formulário flutua num cartão translúcido sobre uma cena 3D que se MEXE.
 * Não existe "o fundo" para medir contraste contra: ele muda a cada quadro, muda
 * com a cor da marca da instalação, e muda com o que o ponteiro está fazendo.
 * Uma medição pontual — na sonda, num screenshot — provaria um instante e
 * deixaria todos os outros sem prova.
 *
 * ── A saída: medir os EXTREMOS, não a cena ───────────────────────────────────
 *
 * O cartão é `--color-surface` a `--vidro-opacidade` de alfa. Então o fundo
 * composto atrás do texto está sempre entre dois pontos, e só dois:
 *
 *   · cena PRETA atrás  → o composto mais escuro possível
 *   · cena BRANCA atrás → o composto mais claro possível (a própria surface)
 *
 * Qualquer cor real de cena cai entre eles. Se o texto passa o piso nos dois
 * extremos, passa em tudo que existe no meio — inclusive numa cena animada,
 * inclusive numa marca que ninguém previu. Isso é prova, não amostragem.
 *
 * ── Por que NÃO há texto em `accent` sobre o vidro ───────────────────────────
 *
 * Este arquivo mediu e a resposta foi não. A régua garante `--color-accent` ≥
 * 4,5:1 sobre `--color-surface`, mas a caminhada de contraste para no PRIMEIRO
 * grau que passa — então há sementes cuja margem é praticamente zero. Qualquer
 * escurecimento do fundo, por menor que seja, as derruba, e não existe opacidade
 * de vidro < 100% que salve todas as 16.
 *
 * Medido com a semente do produto (`#13731b`) a 86%: **4,34:1**, abaixo do piso.
 * Por isso os links do cartão são `--color-text` sublinhado, e `accent` só
 * aparece onde é OPACO — o botão preenchido, onde a garantia da régua vale
 * direto. O caso "accent sobre vidro" abaixo é um controle NEGATIVO: ele existe
 * para reprovar se alguém reintroduzir a ideia.
 *
 * ── `opacity` compõe em sRGB ────────────────────────────────────────────────
 *
 * `frente·α + fundo·(1−α)` sobre os bytes, NÃO mistura perceptual em oklab. Se
 * alguém trocar o `color-mix` do `.ios-vidro` por outra coisa, a cor muda e este
 * teste passa medindo uma composição que a tela não faz.
 */

const RAIZ = process.cwd();
const CSS = fs.readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");
const REGUA: Regua = extrairRegua(CSS);

/**
 * A mesma fixture adversarial de `branding-contraste.test.ts`, e é cópia de
 * propósito: são as sementes que já quebraram alguma coisa. Um teste que só
 * medisse o verde do produto estaria medindo o caso fácil.
 */
const FIXTURE = [
  "#0f172a", "#f5c518", "#ffffff", "#000000", "#808080", "#dc2626", "#22c55e", "#f59e0b",
  "#2563eb", "#14b8a6", "#4b0082", "#e11d48", "#7c3aed", "#1a1f36", "#fafafa", "#13731b",
] as const;

/** Lê uma custom property do bloco `:root` do globals.css. */
function tokenDaRaiz(nome: string): string {
  const m = new RegExp(`${nome}:\\s*([^;]+);`).exec(CSS);
  if (!m?.[1]) throw new Error(`não achei ${nome} em app/globals.css`);
  return m[1].trim();
}

/** `--vidro-opacidade: 86%` → 0.86. É o alfa do cartão, lido da folha. */
function alfaDoVidro(): number {
  const bruto = tokenDaRaiz("--vidro-opacidade");
  const pct = /^([\d.]+)%$/.exec(bruto);
  if (!pct?.[1]) throw new Error(`--vidro-opacidade não é porcentagem: ${bruto}`);
  return Number(pct[1]) / 100;
}

function hexParaRgb(hex: string): [number, number, number] {
  const limpo = hex.replace("#", "");
  return [
    parseInt(limpo.slice(0, 2), 16),
    parseInt(limpo.slice(2, 4), 16),
    parseInt(limpo.slice(4, 6), 16),
  ];
}

/** Composição alfa em sRGB, byte a byte — o que o navegador faz com o cartão. */
function compor(atras: string, frente: string, alfa: number): string {
  const f = hexParaRgb(atras);
  const t = hexParaRgb(frente);
  const canal = (i: 0 | 1 | 2) =>
    Math.round(t[i] * alfa + f[i] * (1 - alfa))
      .toString(16)
      .padStart(2, "0");
  return `#${canal(0)}${canal(1)}${canal(2)}`;
}

/** Os dois únicos extremos que uma cena pode produzir atrás do cartão. */
function extremosDoCartao(alfa: number): { escuro: string; claro: string } {
  const superficie = tokenDaRaiz("--color-surface");
  return {
    escuro: compor("#000000", superficie, alfa),
    claro: compor("#ffffff", superficie, alfa),
  };
}

describe("cartão de vidro — legível sobre qualquer cena", () => {
  it("o vidro é translúcido e respeita o piso de opacidade da doutrina", () => {
    const alfa = alfaDoVidro();
    // Guarda de vacuidade nas duas pontas: um cartão opaco passaria em tudo
    // abaixo sem provar nada, e um cartão quase transparente seria vidro de
    // tela de bloqueio num CRM.
    expect(alfa).toBeGreaterThanOrEqual(0.8);
    expect(alfa).toBeLessThan(1);
  });

  it("o texto do cartão passa o piso nos DOIS extremos de cena", () => {
    const { escuro, claro } = extremosDoCartao(alfaDoVidro());
    const reprovadas: string[] = [];

    for (const token of ["--color-text", "--color-text-muted"] as const) {
      const cor = tokenDaRaiz(token);
      for (const [nome, fundo] of [
        ["cena preta", escuro],
        ["cena branca", claro],
      ] as const) {
        const razao = razaoDeContraste(cor, fundo);
        if (razao < PISOS.texto) {
          reprovadas.push(`${token} sobre ${nome} (${fundo}): ${razao.toFixed(2)}`);
        }
      }
    }

    expect(
      reprovadas,
      "o cartão deixou de ser legível. Suba --vidro-opacidade em app/globals.css:\n" +
        reprovadas.join("\n"),
    ).toEqual([]);
  });

  it("o botão preenchido é OPACO, então vale a garantia da régua nas 16 sementes", () => {
    const reprovadas: string[] = [];
    for (const semente of FIXTURE) {
      // `claro` sempre: `<html data-theme="light">` é fixo no layout raiz.
      const { accent, accentFg } = derivarMarca(semente, REGUA).claro;
      const razao = razaoDeContraste(accentFg, accent);
      if (razao < PISOS.texto) reprovadas.push(`${semente}: ${razao.toFixed(2)}`);
    }
    expect(reprovadas, `o botão do cartão reprovou:\n${reprovadas.join("\n")}`).toEqual([]);
  });

  it("controle NEGATIVO: texto em accent sobre o vidro reprova — por isso não existe na tela", () => {
    const { escuro } = extremosDoCartao(alfaDoVidro());
    const { accent } = derivarMarca("#13731b", REGUA).claro;
    const razao = razaoDeContraste(accent, escuro);

    // Se este caso passar a dar verde, ou a opacidade subiu muito ou a régua
    // mudou — e aí vale reabrir a decisão de não usar accent em texto no cartão.
    // Enquanto reprovar, os links do cartão continuam sendo `--color-text`.
    expect(razao).toBeLessThan(PISOS.texto);
  });

  it("controle NEGATIVO: vidro a 50% derruba o texto — a medição não é vacuosa", () => {
    const meio = compor("#000000", tokenDaRaiz("--color-surface"), 0.5);
    expect(razaoDeContraste(tokenDaRaiz("--color-text-muted"), meio)).toBeLessThan(PISOS.texto);
  });
});
