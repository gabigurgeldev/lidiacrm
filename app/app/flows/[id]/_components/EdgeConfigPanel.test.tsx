/**
 * O painel da LIGAÇÃO — o conserto de "arrastar na bolinha certa".
 *
 * ## O defeito que ele fecha
 *
 * Até aqui, mudar de qual saída uma linha parte exigia arrastar de novo mirando
 * uma bolinha de poucos pixels, empilhada com as outras saídas do bloco. Quem
 * monta um fluxo pela primeira vez não descobre que a bolinha é o que importa;
 * descobre que a linha foi parar no lugar errado, e não descobre como desfazer.
 *
 * ## A asserção que carrega o arquivo
 *
 * A saída OCUPADA por outra linha não pode ser oferecida. O canvas substitui a
 * linha ao ligar duas na mesma saída (`aoLigar`), então oferecer uma saída
 * ocupada aqui significa: a pessoa mexe numa linha e PERDE outra, em silêncio.
 *
 * ## Por que a regra é medida como função, e não abrindo o dropdown
 *
 * O Radix Select não abre em jsdom (`target.hasPointerCapture is not a
 * function`), e um teste que dependesse disso mediria o ambiente, não o
 * produto — a mesma decisão que `PainelDoNo.paralelo.test.tsx` já documenta.
 * Por isso a regra mora em `ramosOferecidos`, exportada, e é exercitada direto.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FlowBranch } from "@/lib/flow-engine/types";

import { EdgeConfigPanel, ramosOferecidos } from "./EdgeConfigPanel";

const RAMOS: FlowBranch[] = [
  { id: "s1k2j9", label: "Lead quente", kind: "match" },
  { id: "s4m7p1", label: "Lead morno", kind: "match" },
  { id: "else", label: "Nenhuma delas", kind: "fallback" },
];

function montar(over: Partial<React.ComponentProps<typeof EdgeConfigPanel>> = {}) {
  const aoTrocarRamo = vi.fn();
  const aoApagar = vi.fn();
  render(
    <EdgeConfigPanel
      origem="Decidir pelo score"
      destino="Avisar o vendedor"
      ramosDaOrigem={RAMOS}
      ramoAtual="s1k2j9"
      ramosOcupados={[]}
      aoTrocarRamo={aoTrocarRamo}
      aoApagar={aoApagar}
      {...over}
    />,
  );
  return { aoTrocarRamo, aoApagar };
}

describe("quais saídas a linha pode passar a representar", () => {
  it("controle: sem nada ocupado, todas são oferecidas", () => {
    // Sem este caso, um `ramosOferecidos` que devolvesse sempre [] passaria
    // na asserção principal por vacuidade.
    expect(ramosOferecidos(RAMOS, "s1k2j9", []).map((r) => r.id)).toEqual([
      "s1k2j9",
      "s4m7p1",
      "else",
    ]);
  });

  it("⭐ a saída que já tem OUTRA linha não é oferecida", () => {
    const ids = ramosOferecidos(RAMOS, "s1k2j9", ["s4m7p1"]).map((r) => r.id);
    expect(
      ids,
      "saída ocupada por outra linha foi oferecida — escolhê-la apagaria a outra em silêncio",
    ).not.toContain("s4m7p1");
    expect(ids).toEqual(["s1k2j9", "else"]);
  });

  it("a saída ATUAL continua na lista mesmo constando como ocupada", () => {
    // Quem a ocupa é esta própria linha. Some-la deixaria o campo apontando
    // para um valor fora da lista, que o Select desenha como caixa vazia.
    expect(ramosOferecidos(RAMOS, "s4m7p1", ["s4m7p1"]).map((r) => r.id)).toContain("s4m7p1");
  });

  it("todas ocupadas por outras: sobra só a atual", () => {
    expect(ramosOferecidos(RAMOS, "s1k2j9", ["s1k2j9", "s4m7p1", "else"]).map((r) => r.id)).toEqual(["s1k2j9"]);
  });
});

describe("o painel de uma ligação", () => {
  it("diz de onde vem e para onde vai, com os nomes dos blocos", () => {
    montar();
    const resumo = screen.getByTestId("resumo-da-aresta");
    expect(resumo).toHaveTextContent("Decidir pelo score");
    expect(resumo).toHaveTextContent("Avisar o vendedor");
  });

  it("mostra a saída atual pelo NOME, nunca pelo identificador", () => {
    montar();
    const campo = screen.getByTestId("campo-ramo-da-aresta");
    expect(campo.textContent).toContain("Lead quente");
    expect(campo.textContent, "o identificador cru vazou para a tela").not.toContain("s1k2j9");
  });

  it("bloco de saída única não oferece escolha nenhuma", () => {
    montar({ ramosDaOrigem: [], ramoAtual: "else" });
    expect(screen.getByTestId("sem-ramo-disponivel")).toBeInTheDocument();
    expect(screen.queryByTestId("campo-ramo-da-aresta")).not.toBeInTheDocument();
  });

  it("dá para remover a ligação", async () => {
    const { aoApagar } = montar();
    await userEvent.click(screen.getByTestId("apagar-aresta"));
    expect(aoApagar).toHaveBeenCalledOnce();
  });
});
