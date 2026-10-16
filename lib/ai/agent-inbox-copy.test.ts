import { describe, expect, it } from "vitest";
import {
  copyDaLacuna,
  copyDaPromessaSemDono,
  kindLabel,
  KIND_LABEL,
  SEVERITY_LABEL,
  type PromessaSemDono,
} from "./agent-inbox-copy";

describe("agent-inbox-copy — rótulos leigos dos avisos do runtime", () => {
  it("traduz kinds conhecidos do schema (agent_inbox_items.kind)", () => {
    expect(kindLabel("qr_rescan")).toContain("QR");
    expect(kindLabel("budget_exceeded")).toContain("orçamento");
    expect(kindLabel("handoff")).toContain("humano");
  });

  it("kind desconhecido cai no rótulo genérico sem quebrar", () => {
    expect(kindLabel("kind_novo_do_engine")).toBe("Aviso do assistente");
  });

  /**
   * A versão anterior deste teste se chamava "cobre todos os kinds do check
   * constraint" e comparava contra uma **cópia congelada** do CHECK da 0050.
   * Três migrations depois (`followup_dead`, `snooze_expired`,
   * `next_action_ambiguous`) a lista nunca cresceu: o teste continuou verde
   * afirmando cobrir uma fonte da verdade que já não lia. Um teste que copia
   * aquilo que deveria conferir só verifica a si mesmo.
   *
   * A cobertura agora é mecânica e mora em dois lugares que NÃO envelhecem:
   *   compilador → `satisfies Record<InboxKind, string>` em agent-inbox-copy.ts
   *                (kind no tipo sem rótulo = erro de build)
   *   Postgres   → tests/invariants/vocabulario-banco-x-typescript.test.ts
   *                (CHECK do banco × InboxKind, contra banco real)
   * Aqui fica só o que nenhum dos dois vê: se o rótulo é texto útil.
   */
  it("todo rótulo é frase em pt-BR, não o identificador cru", () => {
    const chaves = Object.keys(KIND_LABEL);
    expect(chaves.length).toBeGreaterThan(0);
    for (const k of chaves) {
      const rotulo = KIND_LABEL[k as keyof typeof KIND_LABEL];
      expect(rotulo, `sem rótulo para kind '${k}'`).toBeTruthy();
      expect(rotulo, `rótulo de '${k}' é o próprio identificador`).not.toBe(k);
      expect(rotulo, `rótulo de '${k}' vazou snake_case`).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });

  it("o item ambíguo se anuncia pelo que pede, não pelo genérico", () => {
    // Regressão direta: este kind nasceu na 0073 e chegou à tela caindo no
    // "Aviso do assistente" — genérico num item cuja razão de existir é pedir
    // uma escolha. O teste falha se alguém remover o rótulo.
    expect(kindLabel("next_action_ambiguous")).not.toBe("Aviso do assistente");
    expect(kindLabel("next_action_ambiguous")).toContain("escolha");
  });

  it("severidades têm rótulo leigo", () => {
    expect(SEVERITY_LABEL.info).toBe("informativo");
    expect(SEVERITY_LABEL.warn).toBe("atenção");
    expect(SEVERITY_LABEL.critical).toBe("crítico");
  });
});

/**
 * A REGRA DE ESCRITA DESTE AVISO: ele nunca afirma cumprimento.
 *
 * O texto anterior dizia "o sistema ainda não registrou o cumprimento" — um
 * veredito que nenhuma linha de código apurava, no único item que a feature dos
 * três papéis mostra ao dono do negócio. O que se apura é se alguém ficou
 * RESPONSÁVEL; se foi cumprida, o sistema não sabe.
 */
describe("copyDaPromessaSemDono — o aviso só afirma o que foi apurado", () => {
  const MOTIVOS: PromessaSemDono[] = [
    "operador_sem_ferramentas",
    "operador_nao_agiu",
    "operador_nao_rodou",
  ];

  it("NENHUM texto fala em cumprimento — nem no título, nem no corpo", () => {
    for (const porque of MOTIVOS) {
      const { title, body } = copyDaPromessaSemDono(1, porque);
      const texto = `${title} ${body}`.toLowerCase();
      for (const proibido of ["cumpriu", "cumprida", "cumprido", "cumprimento"]) {
        expect(texto, `o motivo ${porque} voltou a afirmar cumprimento ("${proibido}")`).not.toContain(
          proibido,
        );
      }
    }
  });

  it("o rótulo do kind também não afirma cumprimento", () => {
    // O rótulo é o que aparece na lista da Central, antes de alguém abrir o item
    // — se ele afirma e o corpo não, a tela se contradiz.
    expect(kindLabel("promise_unfulfilled").toLowerCase()).not.toContain("cumpri");
    expect(kindLabel("promise_unfulfilled")).toContain("responsável");
  });

  it("sem capacidade marcada, manda para a tela do assistente", () => {
    const { body } = copyDaPromessaSemDono(1, "operador_sem_ferramentas");
    expect(body).toContain("capacidade");
    expect(body).toContain("tela do assistente");
  });

  it("com capacidade e sem ação, NÃO manda configurar nada — manda decidir", () => {
    // As duas variantes existem justamente para separar as ações. Se o texto do
    // "não agiu" mandasse marcar capacidades, metade das pessoas iria mexer na
    // configuração por um problema que não é de configuração.
    const { body } = copyDaPromessaSemDono(1, "operador_nao_agiu");
    expect(body).not.toContain("capacidade");
    expect(body).toContain("decida quem faz");
  });

  it("plural: o título conta as promessas", () => {
    expect(copyDaPromessaSemDono(3, "operador_nao_agiu").title).toContain("3 promessas");
    expect(copyDaPromessaSemDono(1, "operador_nao_agiu").title).not.toContain("1 promessas");
  });

  it("nenhum texto carrega vocabulário interno", () => {
    // Quem lê é dono de clínica. O nome do motivo é chave de código e não pode
    // vazar para a tela — é o mesmo defeito que a spec dos três papéis existe
    // para matar, um nível acima.
    for (const porque of MOTIVOS) {
      const { title, body } = copyDaPromessaSemDono(2, porque);
      const texto = `${title} ${body}`;
      for (const jargao of ["operador_", "operator", "mcp", "tool", "payload", "job"]) {
        expect(texto.toLowerCase(), `jargão "${jargao}" no texto de ${porque}`).not.toContain(jargao);
      }
    }
  });
});

describe("copyDaLacuna (migration 0245)", () => {
  it("o título traz a pergunta e quantas vezes ela voltou", () => {
    const { title } = copyDaLacuna("vocês têm na cor azul?", 5);
    expect(title).toContain("vocês têm na cor azul?");
    expect(title).toContain("(5 vezes)");
    expect(copyDaLacuna("x", 1).title).toContain("(1 vez)");
  });

  it("pergunta longa é recortada no título", () => {
    const { title } = copyDaLacuna("a".repeat(400), 2);
    expect(title.length).toBeLessThan(260);
    expect(title).toContain("…");
  });

  it("o corpo não promete que o agente aprendeu sozinho", () => {
    expect(copyDaLacuna("x", 1).body.toLowerCase()).not.toMatch(/aprendeu|aprende sozinho/);
  });
});
