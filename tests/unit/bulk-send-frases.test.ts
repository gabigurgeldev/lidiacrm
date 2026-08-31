/**
 * CÓDIGO CRU NUNCA CHEGA À TELA.
 *
 * O banco tem dois vocabulários fechados do disparo em massa —
 * `bulk_send_recipients_skip_reason_check` e `bulk_sends_pause_reason_check` —
 * e a tela precisa de uma frase em pt-BR para cada valor deles. Um valor novo
 * no CHECK sem frase correspondente apareceria ao operador como
 * `contact_anonymized`, que não diz nada a quem não escreveu o código.
 *
 * Este teste varre o CHECK NO BASELINE (o arquivo que o self-hoster realmente
 * aplica) e cobra a correspondência nos DOIS sentidos:
 *
 *   * todo valor do banco tem frase — senão a tela mostra código cru;
 *   * toda frase corresponde a um valor do banco — senão é frase morta, e
 *     frase morta é sinal de vocabulário que mudou e ninguém acompanhou.
 *
 * A varredura é contra o baseline e não contra a migration de propósito: são
 * dois caminhos de schema (`docs/doctrine/...`), e o baseline é o que chega ao
 * clone. `tests/unit/kind-check-migration-x-baseline.test.ts` já vigia que os
 * dois não divirjam.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  fraseDaPausa,
  fraseDoPulo,
  motivosDePausaConhecidos,
  motivosDePuloConhecidos,
} from "@/lib/bulk-send/frases";

const BASELINE = join(process.cwd(), "supabase", "baseline.sql");

/**
 * Vocabulário de um `add constraint <nome> check (... in ( … ))` do baseline.
 *
 * Devolve `null` quando a constraint não é encontrada — que é DIFERENTE de
 * "lista vazia", e a diferença é o que impede este teste de ficar verde por não
 * medir nada no dia em que alguém renomear a constraint. Os comentários saem
 * antes do parse porque vários contêm parênteses, e o fechamento da lista seria
 * lido no parêntese errado (mesma armadilha documentada em
 * `kind-check-migration-x-baseline.test.ts`).
 */
function vocabularioDoBaseline(constraint: string): string[] | null {
  const sql = readFileSync(BASELINE, "utf8").replace(/--[^\n]*/g, "");
  const abre = new RegExp(`add\\s+constraint\\s+${constraint}\\s+check\\s*\\(`, "is");
  const m = abre.exec(sql);
  if (!m) return null;
  const trecho = sql.slice(m.index, m.index + 800);
  const emIn = /\bin\s*\(([^)]*)\)/is.exec(trecho);
  if (!emIn) return null;
  return [...emIn[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

describe("controle: a sonda enxerga o baseline", () => {
  it("acha os dois vocabulários e eles não vêm vazios", () => {
    const pulos = vocabularioDoBaseline("bulk_send_recipients_skip_reason_check");
    const pausas = vocabularioDoBaseline("bulk_sends_pause_reason_check");
    expect(pulos, "constraint de skip_reason não encontrada no baseline").not.toBeNull();
    expect(pausas, "constraint de pause_reason não encontrada no baseline").not.toBeNull();
    expect(pulos!.length).toBeGreaterThan(2);
    expect(pausas!.length).toBeGreaterThan(2);
  });
});

describe("motivo de pulo — banco x frase", () => {
  it("todo valor do CHECK tem frase em pt-BR", () => {
    const doBanco = vocabularioDoBaseline("bulk_send_recipients_skip_reason_check")!;
    const semFrase = doBanco.filter((v) => fraseDoPulo(v) === null);
    expect(semFrase, "valores no banco sem frase para a tela").toEqual([]);
  });

  it("nenhuma frase sobra sem valor no banco", () => {
    const doBanco = new Set(vocabularioDoBaseline("bulk_send_recipients_skip_reason_check")!);
    const orfas = motivosDePuloConhecidos().filter((m) => !doBanco.has(m));
    expect(orfas, "frases sem valor correspondente no banco").toEqual([]);
  });

  it("cada frase traz próximo passo não vazio", () => {
    for (const motivo of motivosDePuloConhecidos()) {
      const d = fraseDoPulo(motivo)!;
      expect(d.frase.trim().length, `frase vazia em ${motivo}`).toBeGreaterThan(0);
      expect(d.proximoPasso.trim().length, `próximo passo vazio em ${motivo}`).toBeGreaterThan(0);
    }
  });

  /**
   * Este caso é de CONFORMIDADE, não de estilo. Oferecer "tentar de novo" para
   * quem pediu para parar seria o produto ajudando a furar um opt-out
   * registrado — e um botão a mais é fácil de acrescentar por engano.
   */
  it("bloqueio e recusa NUNCA oferecem reenvio", () => {
    expect(fraseDoPulo("contact_blocked")!.tentarDeNovo).toBe(false);
    expect(fraseDoPulo("consent_declined")!.tentarDeNovo).toBe(false);
  });

  it("motivo desconhecido devolve null em vez de frase inventada", () => {
    expect(fraseDoPulo("motivo_que_nao_existe")).toBeNull();
    expect(fraseDoPulo(null)).toBeNull();
    expect(fraseDoPulo(undefined)).toBeNull();
  });
});

describe("motivo de pausa — banco x frase", () => {
  it("todo valor do CHECK tem frase em pt-BR", () => {
    const doBanco = vocabularioDoBaseline("bulk_sends_pause_reason_check")!;
    const semFrase = doBanco.filter((v) => fraseDaPausa(v) === null);
    expect(semFrase, "valores no banco sem frase para a tela").toEqual([]);
  });

  it("nenhuma frase sobra sem valor no banco", () => {
    const doBanco = new Set(vocabularioDoBaseline("bulk_sends_pause_reason_check")!);
    const orfas = motivosDePausaConhecidos().filter((m) => !doBanco.has(m));
    expect(orfas).toEqual([]);
  });

  /**
   * Os três vetos do pacing levam a Conexões porque é LÁ que os knobs se mudam.
   * Uma pausa que diz "esperando a janela" sem dizer onde a janela se muda é o
   * `return` mudo que o invariante 6 proíbe, só que com texto.
   */
  it("os vetos do pacing apontam para onde se muda a régua", () => {
    for (const motivo of ["outside_window", "warmup_cap", "daily_cap"]) {
      expect(fraseDaPausa(motivo)!.abrirConexoes, `${motivo} não aponta para Conexões`).toBe(true);
    }
    expect(fraseDaPausa("operador")!.abrirConexoes).toBe(false);
  });
});
