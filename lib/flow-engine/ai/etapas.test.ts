/**
 * A ACEITAÇÃO PARCIAL PRECISA SER PROVADA, NÃO CONFIADA.
 *
 * É a única razão de a geração ter virado etapas. No caminho anterior o grafo
 * inteiro vinha numa resposta só, validada contra um `z.strictObject` por tipo:
 * um `config` divergente entre vinte blocos apagava TUDO. Aqui um bloco que
 * falha vira valores padrão e os irmãos seguem — e "seguem" é uma afirmação que
 * só vale medida.
 *
 * A porta é falsa de propósito: nenhuma chamada de rede, e o controle sobre
 * QUAL bloco falha é o que permite testar o caso que dói.
 */
import { describe, expect, it, vi } from "vitest";

import { CONCORRENCIA_PADRAO, gerarConfigs, TENTATIVAS_POR_BLOCO } from "./etapas";
import type { PedidoAoModelo, PortaDeModelo, ResultadoDoModelo } from "./modelo-com-fallback";
import type { PlanoDeFluxo } from "./plan-schema";
import { garantirNosRegistrados } from "../register-all";

garantirNosRegistrados();

const plano: PlanoDeFluxo = {
  blocos: [
    { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
    { id: "w1", tipo: "logic.wait", rotulo: "Espera", intencao: "esperar 10 minutos" },
    { id: "tag", tipo: "crm.add_tag", rotulo: "Etiqueta", intencao: "marcar como novo" },
    { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
  ],
  ligacoes: [
    { de: "t1", para: "w1" },
    { de: "w1", para: "tag" },
    { de: "tag", para: "fim" },
  ],
};

/** Porta falsa: decide por rótulo o que responder, e conta os voos simultâneos. */
function portaFalsa(
  responder: (pedido: PedidoAoModelo<unknown>) => { ok: boolean; objeto?: unknown },
  medidor?: { voando: number; pico: number },
): PortaDeModelo {
  return {
    async objeto<T>(pedido: PedidoAoModelo<T>): Promise<ResultadoDoModelo<T>> {
      if (medidor) {
        medidor.voando += 1;
        medidor.pico = Math.max(medidor.pico, medidor.voando);
      }
      await new Promise((r) => setTimeout(r, 5));
      if (medidor) medidor.voando -= 1;
      const r = responder(pedido as PedidoAoModelo<unknown>);
      return {
        ok: r.ok,
        objeto: r.objeto as T | undefined,
        causa: r.ok ? undefined : "recusado pelo provedor",
        finishReason: r.ok ? "stop" : undefined,
        avisos: r.ok ? [] : ['{"type":"unsupported-setting"}'],
        tokensEntrada: 10,
        tokensSaida: 20,
        modeloUsado: "modelo/teste",
        usouReserva: false,
      };
    },
  };
}

/**
 * Um plano COM RAMO — o caso do `logic.if`, que é onde o defeito de rótulo mora.
 */
const planoComRamo: PlanoDeFluxo = {
  blocos: [
    { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
    { id: "se", tipo: "logic.if", rotulo: "Decidir", intencao: "duas saídas" },
    { id: "a", tipo: "crm.add_tag", rotulo: "Marcar", intencao: "marcar" },
    { id: "b", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
  ],
  ligacoes: [
    { de: "t1", para: "se" },
    { de: "se", para: "a", ramo: "Ainda não respondeu" },
    { de: "se", para: "b", ramo: "Já respondeu" },
  ],
};

describe("os rótulos de ramo chegam à etapa 2", () => {
  /**
   * POR QUE ISTO É UM TESTE, e não confiança no prompt.
   *
   * MEDIDO contra o provedor real, no mesmo fluxo: a etapa 1 escreveu os ramos
   * "Ainda não respondeu"/"Já respondeu" e a etapa 2, que não os via, escreveu
   * as saídas "Sem resposta"/"Já respondido". Nenhum par casa — e o casamento
   * por rótulo de `resolverRamo` é o caminho normal da reconciliação. Ele caía
   * no desempate por ORDEM, que acertou por sorte.
   *
   * Uma aresta no ramo errado não quebra nada visível: o grafo desenha bonito,
   * `analisarGrafo` não reclama, e o primeiro lead segue pelo caminho errado.
   */
  it("o prompt do bloco que decide carrega os rótulos que o PLANO declarou", async () => {
    const prompts = new Map<string, string>();
    const porta = portaFalsa((pedido) => {
      prompts.set(pedido.rotulo, pedido.prompt);
      return { ok: true, objeto: { saidas: [{ id: "s1", label: "x" }] } };
    });

    await gerarConfigs(porta, planoComRamo, "pedido");

    const doSe = [...prompts.entries()].find(([rotulo]) => rotulo.startsWith("se:"))?.[1] ?? "";
    expect(doSe).toContain("Ainda não respondeu");
    expect(doSe).toContain("Já respondeu");
    // A ORDEM importa tanto quanto a presença: `resolverRamo` usa a posição como
    // rede, e as duas regras só concordam se a ordem for a mesma.
    expect(doSe.indexOf("Ainda não respondeu")).toBeLessThan(doSe.indexOf("Já respondeu"));
  });

  it("um bloco sem ramo nenhum não ganha a exigência", async () => {
    // Guarda de vacuidade e de custo: a frase é instrução para o modelo, e
    // mandá-la num bloco sem saídas nomeadas é ruído pago em token.
    const prompts = new Map<string, string>();
    const porta = portaFalsa((pedido) => {
      prompts.set(pedido.rotulo, pedido.prompt);
      return { ok: true, objeto: { tag: "novo" } };
    });

    await gerarConfigs(porta, planoComRamo, "pedido");

    const doA = [...prompts.entries()].find(([rotulo]) => rotulo.startsWith("a:"))?.[1] ?? "";
    expect(doA).not.toContain("DEVEM se chamar");
  });
});

describe("gerarConfigs", () => {
  it("um bloco que falha vira exemplo e NÃO derruba os irmãos", async () => {
    const porta = portaFalsa((pedido) => {
      if (pedido.rotulo.startsWith("w1")) return { ok: false };
      if (pedido.rotulo.startsWith("tag")) return { ok: true, objeto: { tag: "novo" } };
      return { ok: true, objeto: { desfecho: "concluido" } };
    });

    const { configs, telemetria } = await gerarConfigs(porta, plano, "pedido");

    expect(configs.get("w1")?.origem).toBe("exemplo");
    expect(configs.get("w1")?.causa).toContain("recusado");
    // A prova: os irmãos continuaram e vieram do modelo.
    expect(configs.get("tag")?.origem).toBe("ia");
    expect(configs.get("fim")?.origem).toBe("ia");
    expect(configs.size).toBe(4);
    expect(telemetria.comExemplo).toBe(1);
  });

  it("tenta duas vezes antes de desistir de um bloco", async () => {
    let tentativas = 0;
    const porta = portaFalsa((pedido) => {
      if (!pedido.rotulo.startsWith("w1")) return { ok: true, objeto: { tag: "x" } };
      tentativas += 1;
      return { ok: false };
    });

    await gerarConfigs(porta, plano, "pedido");
    expect(tentativas).toBe(TENTATIVAS_POR_BLOCO);
  });

  it("nunca passa da concorrência declarada", async () => {
    const medidor = { voando: 0, pico: 0 };
    const grande: PlanoDeFluxo = {
      blocos: Array.from({ length: 12 }, (_, i) => ({
        id: `n${i}`,
        tipo: "crm.add_tag",
        rotulo: `Bloco ${i}`,
        intencao: "etiquetar",
      })),
      ligacoes: [],
    };
    await gerarConfigs(
      portaFalsa(() => ({ ok: true, objeto: { tag: "x" } }), medidor),
      grande,
      "pedido",
    );
    expect(medidor.pico).toBeLessThanOrEqual(CONCORRENCIA_PADRAO);
  });

  it("tipo sem campo nenhum não gasta chamada", async () => {
    const vistos: string[] = [];
    const porta = portaFalsa((pedido) => {
      vistos.push(pedido.rotulo);
      return { ok: true, objeto: { tag: "x" } };
    });
    await gerarConfigs(porta, plano, "pedido");
    // `trigger.lead_created` tem config vazia: pedir a um provedor que preencha
    // um objeto sem propriedades é chamada paga para receber `{}` — e parte
    // deles recusa.
    expect(vistos.some((r) => r.startsWith("t1"))).toBe(false);
  });

  it("agrega finishReason e warnings — é o que a rota registra", async () => {
    const porta = portaFalsa((pedido) =>
      pedido.rotulo.startsWith("w1") ? { ok: false } : { ok: true, objeto: { tag: "x" } },
    );
    const { telemetria } = await gerarConfigs(porta, plano, "pedido");

    expect(telemetria.chamadas).toBeGreaterThan(0);
    expect(telemetria.finishReasons.stop).toBeGreaterThan(0);
    // A falha entra como "erro" e o aviso do provedor é preservado: é assim que
    // "o provedor está ignorando o response_format" aparece no log.
    expect(telemetria.finishReasons.erro).toBe(TENTATIVAS_POR_BLOCO);
    expect(telemetria.warnings.length).toBeGreaterThan(0);
  });

  it("aoConcluir que lança não derruba a geração", async () => {
    const porta = portaFalsa(() => ({ ok: true, objeto: { tag: "x" } }));
    const explode = vi.fn(() => {
      throw new Error("a tela quebrou");
    });
    const { configs } = await gerarConfigs(porta, plano, "pedido", {}, explode);
    expect(configs.size).toBe(4);
    expect(explode).toHaveBeenCalled();
  });

  it("respeita o cancelamento — bloco abortado não é tentado de novo", async () => {
    const controle = new AbortController();
    controle.abort();
    let chamadas = 0;
    const porta = portaFalsa(() => {
      chamadas += 1;
      return { ok: true, objeto: { tag: "x" } };
    });
    const { configs } = await gerarConfigs(porta, plano, "pedido", { sinal: controle.signal });
    expect(chamadas).toBe(0);
    // Ainda assim devolve tudo, com valores padrão: a tela recebe um grafo, e
    // não um vazio sem explicação.
    expect(configs.size).toBe(4);
  });
});
