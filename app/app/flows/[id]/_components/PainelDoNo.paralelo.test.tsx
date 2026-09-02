/**
 * OS FORMULÁRIOS DOS BLOCOS DO PARALELO — exercitados como a pessoa os usa.
 *
 * ## Por que este arquivo existe
 *
 * A suíte de unidade prova que o motor bifurca, repete e espera; a de
 * invariantes prova que o schema isola e anonimiza. Nenhuma das duas prova a
 * única coisa que o cliente compra: **que dá para montar o fluxo**.
 *
 * O modo de falha concreto que ele barra: o `switch` de `Ajustes` cai num
 * `default` que diz "Este bloco não tem ajustes". Para `logic.merge` isso é
 * verdade — ele não decide nada. Para os outros quatro seria MENTIRA: eles têm
 * config obrigatória, e sem formulário o bloco nasce no canvas, parece pronto,
 * e a publicação o recusa sem a pessoa ter onde consertar. Um bloco assim passa
 * em todo teste de backend e não serve para nada.
 *
 * ## ⚠️ O que este arquivo NÃO é
 *
 * NÃO é a prova pela tela que a doutrina de QA Visual exige — aquela é
 * Playwright em ambiente fresco estilo VPS, e ela NÃO foi executada nesta
 * sessão: o stack local do Supabase não sobe nesta máquina (os contêineres
 * `pg_meta` e `studio` morrem com `invalid ELF header` no libc, o mesmo defeito
 * de arquitetura do Docker local que faz `pgvector/pgvector:pg15` responder
 * `exec format error` enquanto a `pg16` roda). A spec existe
 * (`tests/e2e/flow-blocos-do-paralelo.spec.ts`) e está declarada no CI; o que
 * falta é a EXECUÇÃO.
 *
 * Este arquivo cobre o que dá para cobrir sem navegador: que o formulário
 * ABRE, com os campos certos, e que as escolhas chegam ao config.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EVENTOS_QUE_ACORDAM } from "@/lib/flow-engine/nodes/paralelo";

import { PainelDoNo } from "./PainelDoNo";

function montar(tipo: string, config: Record<string, unknown> = {}) {
  const aoMudarConfig = vi.fn();
  render(
    <PainelDoNo
      tipo={tipo}
      rotulo="Bloco de prova"
      config={config}
      aoMudarRotulo={vi.fn()}
      aoMudarConfig={aoMudarConfig}
      aoApagar={vi.fn()}
      podeApagar
    />,
  );
  return { aoMudarConfig };
}

describe("o formulário de cada bloco do paralelo", () => {
  it("`logic.fork`: nomear caminhos, escolher como se juntam, e dizer onde", () => {
    montar("logic.fork", {
      ramos: [
        { id: "a", label: "Avisar o vendedor" },
        { id: "b", label: "Marcar o lead" },
      ],
      modo: "todas",
      encontro: "junta",
    });

    expect(screen.getByTestId("campo-modo-do-fork")).toBeInTheDocument();
    expect(screen.getByTestId("campo-encontro-do-fork")).toBeInTheDocument();
    expect(screen.getByTestId("rotulo-do-ramo-a")).toHaveValue("Avisar o vendedor");
    expect(screen.getByTestId("rotulo-do-ramo-b")).toHaveValue("Marcar o lead");
  });

  it("`logic.fork`: acrescentar caminho gera um id PRÓPRIO, não derivado do rótulo", async () => {
    // O id é o que a ligação no quadro guarda. Derivá-lo do rótulo faria
    // renomear o caminho soltar a linha — silenciosamente.
    const { aoMudarConfig } = montar("logic.fork", {
      ramos: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      modo: "todas",
      encontro: "junta",
    });

    await userEvent.click(screen.getByTestId("add-ramo"));

    const chamada = aoMudarConfig.mock.calls.at(-1)?.[0] as { ramos: { id: string }[] };
    expect(chamada.ramos).toHaveLength(3);
    expect(chamada.ramos[2]!.id).not.toBe("");
    expect(new Set(chamada.ramos.map((r) => r.id)).size).toBe(3);
  });

  it("`logic.merge`: é o ÚNICO que legitimamente não tem campos, e explica o porquê", () => {
    montar("logic.merge", {});
    // Não decide nada — quem decide se o reencontro pode seguir é o motor. Mas
    // a tela não pode ficar muda: ela diz para onde apontar a bifurcação.
    expect(screen.getByText(/reencontro|voltam a ser um só/i)).toBeInTheDocument();
  });

  it("`logic.loop`: pede a lista e o teto — e o teto não é opcional na tela", () => {
    montar("logic.loop", { lista: "vars.itens", max: 10 });

    expect(screen.getByTestId("campo-lista-do-laco")).toHaveValue("vars.itens");
    const teto = screen.getByTestId("campo-teto-do-laco");
    expect(teto).toHaveValue(10);
    // O teto é a razão de o laço poder existir: sem ele a validação de
    // publicação proibiria o ciclo. A tela tem que deixar isso claro.
    expect(screen.getByText(/garante que a repetição termina/i)).toBeInTheDocument();
  });

  it("`logic.loop`: o teto é preso entre 1 e 100 pela própria tela", async () => {
    const { aoMudarConfig } = montar("logic.loop", { lista: "vars.itens", max: 10 });

    const teto = screen.getByTestId("campo-teto-do-laco");
    await userEvent.clear(teto);
    await userEvent.type(teto, "999");

    // A tela não deixa passar um valor que o schema recusaria depois — melhor
    // corrigir no campo do que na recusa da publicação.
    const ultimo = aoMudarConfig.mock.calls.at(-1)?.[0] as { max: number };
    expect(ultimo.max).toBeLessThanOrEqual(100);
  });

  it("`logic.await_event`: TODO evento da lista canônica tem rótulo humano na tela", () => {
    // Não abre o dropdown de propósito: o Radix Select não abre em jsdom
    // (`target.hasPointerCapture is not a function`), e um teste que dependa
    // disso mede o ambiente, não o produto. O que importa aqui é outra coisa —
    // que a tela cubra a lista INTEIRA que o handler do barramento escuta.
    //
    // Se a tela repetisse os valores à mão, ela divergiria dessa lista, e a
    // divergência é a mais silenciosa que este bloco pode ter: a pessoa escolhe
    // a opção, o fluxo dorme, o evento acontece — e ninguém acorda, porque o
    // handler nunca soube dele. Percorrer `EVENTOS_QUE_ACORDAM` aqui é o que
    // reprova no dia em que alguém acrescentar um evento e esquecer da tela.
    for (const evento of EVENTOS_QUE_ACORDAM) {
      const { unmount } = render(
        <PainelDoNo
          tipo="logic.await_event"
          rotulo="x"
          config={{ evento, quando: {}, prazo_ms: 3_600_000 }}
          aoMudarRotulo={vi.fn()}
          aoMudarConfig={vi.fn()}
          aoApagar={vi.fn()}
          podeApagar
        />,
      );
      const gatilho = screen.getByTestId("campo-evento-esperado");
      // O identificador cru NÃO pode ser o que a pessoa lê.
      expect(gatilho.textContent, `${evento} aparece cru na tela`).not.toContain(evento);
      expect(gatilho.textContent?.trim().length, `${evento} sem rótulo`).toBeGreaterThan(3);
      unmount();
    }
  });

  it("`logic.await_event`: o prazo aparece em HORAS, não em milissegundos", () => {
    // `prazo_ms` é a unidade do schema; ninguém monta fluxo pensando em
    // milissegundos. Um campo pedindo 3600000 é um campo que a pessoa erra.
    montar("logic.await_event", { evento: "message.received", quando: {}, prazo_ms: 7_200_000 });
    expect(screen.getByTestId("campo-prazo-do-evento")).toHaveValue(2);
  });

  it("`flow.call`: pede qual fluxo chamar", () => {
    montar("flow.call", { fluxo_id: "", entrada: {} });
    expect(screen.getByTestId("campo-fluxo-chamado")).toBeInTheDocument();
  });

  it("nenhum dos quatro com config cai no 'não tem ajustes'", () => {
    // O caso-guarda do arquivo inteiro. Um bloco novo registrado sem entrada no
    // `switch` cai aqui, e cai em silêncio: ele aparece na paleta, entra no
    // canvas, e não há onde configurá-lo.
    for (const [tipo, config] of [
      ["logic.fork", { ramos: [{ id: "a", label: "A" }, { id: "b", label: "B" }], modo: "todas", encontro: "j" }],
      ["logic.loop", { lista: "vars.x", max: 3 }],
      ["logic.await_event", { evento: "message.received", quando: {}, prazo_ms: 3_600_000 }],
      ["flow.call", { fluxo_id: "", entrada: {} }],
    ] as const) {
      const { unmount } = render(
        <PainelDoNo
          tipo={tipo}
          rotulo="x"
          config={config as Record<string, unknown>}
          aoMudarRotulo={vi.fn()}
          aoMudarConfig={vi.fn()}
          aoApagar={vi.fn()}
          podeApagar
        />,
      );
      expect(
        screen.queryByText(/não tem ajustes/i),
        `${tipo} caiu no default do switch`,
      ).not.toBeInTheDocument();
      unmount();
    }
  });
});
