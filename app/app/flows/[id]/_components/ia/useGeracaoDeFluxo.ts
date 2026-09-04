"use client";

/**
 * As duas etapas, do lado do browser — duas chamadas JSON, e nada mais.
 *
 * ═══ ⚠️ A ETAPA 2 ERA UM STREAM SSE, E DEIXOU DE SER ═══
 *
 * A tela mostrava o esqueleto na hora e cada bloco "acendendo" quando o config
 * dele ficava pronto. Numa VPS real ela travava em "Montando N blocos…" para
 * sempre — e a própria frase entregou a causa: ela só é desenhada DEPOIS que a
 * etapa 1 respondeu, então o POST **JSON** atravessava o proxy do cliente e o
 * **stream** não. Nenhuma chamada ao modelo falhava; o defeito era o transporte.
 *
 * Hoje as duas etapas passam pelo mesmo `apiClient.post`, que é o caminho já
 * provado em produção. O que se perde é o progresso ao vivo. O que se ganha é a
 * geração terminar.
 *
 * ═══ Por que continuam sendo DUAS chamadas ═══
 *
 * Não é sobra do desenho antigo. A etapa 1 (o plano) é o que devolve o
 * ESQUELETO ao canvas em segundos, e ela é curta — ~11s medidos contra o
 * provedor real. A etapa 2 é longa e é a que pode ser cortada por um proxy
 * apertado. Separadas, uma falha na segunda deixa a primeira de pé; juntas, uma
 * resposta só de ~35s teria de sobreviver inteira ou não valer nada.
 *
 * ═══ ⚠️ E POR QUE ELAS VIRARAM DOIS MÉTODOS, E NÃO UM ═══
 *
 * `iniciar()` fazia as duas em sequência. O plano chegava, era usado para
 * desenhar o esqueleto, e a montagem começava no mesmo instante — então a
 * pessoa NUNCA via o que ia ser montado antes de o canvas dela ser substituído.
 * A informação existia (o plano traz `rotulo` e `intencao` de cada bloco) e era
 * consumida por dentro. `planejar()` devolve e para; `montar()` é o passo que a
 * pessoa manda dar. Nenhuma chamada a mais.
 *
 * ═══ Falhar na etapa 2 NÃO apaga o trabalho ═══
 *
 * O esqueleto fica no quadro. Ele é um grafo válido — `configExemploDoTipo` em
 * cada bloco, aprovado por `flowGraphSchema` — e "Salvar rascunho" funciona nele
 * como em qualquer outro. É a mesma doutrina que `gerarConfigs` já aplica bloco
 * a bloco (falha de uma parte não apaga o resto), subida um nível: a IA sempre
 * entrega um fluxo, no pior caso um para preencher à mão.
 */
import * as React from "react";

import { apiClient } from "@/lib/api/client";
import type { PlanoDeFluxo } from "@/lib/flow-engine/ai/plan-schema";
import { planoParaGrafo, type ConfigResolvida } from "@/lib/flow-engine/ai/plan-to-graph";
import type { Conserto } from "@/lib/flow-engine/ai/reparar";
import type { ErroDeGrafo, FlowGraph } from "@/lib/flow-engine/graph-schema";

export type FaseDaGeracao =
  | "parado"
  | "planejando"
  | "planejado"
  | "montando"
  | "pronto"
  | "falhou";

export interface Mensagem {
  papel: "usuario" | "ia";
  texto: string;
}

export interface EstadoDaGeracao {
  fase: FaseDaGeracao;
  plano: PlanoDeFluxo | null;
  /** Quantos blocos o plano pediu — o que a tela diz que está montando. */
  total: number;
  /** Quantos ficaram com valores padrão — a tela AVISA, não esconde. */
  comExemplo: number;
  grafo: FlowGraph | null;
  erro: string | null;
  /** O que o reparo determinístico arrumou sozinho. A tela diz — ver `Consertos`. */
  consertos: Conserto[];
  /** O que ainda impede publicar. Vazio quando o fluxo está pronto para publicar. */
  pendencias: ErroDeGrafo[];
  /**
   * `true` quando a etapa 2 falhou e o que ficou no quadro é só o esqueleto.
   *
   * A tela precisa distinguir isto de uma falha seca: aqui existe um fluxo
   * utilizável esperando, e mandar a pessoa "tentar de novo" sem dizer que os
   * blocos já estão lá é o mesmo que escondê-los.
   */
  somenteEsqueleto: boolean;
}

const INICIAL: EstadoDaGeracao = {
  fase: "parado",
  plano: null,
  total: 0,
  comExemplo: 0,
  grafo: null,
  erro: null,
  consertos: [],
  pendencias: [],
  somenteEsqueleto: false,
};

/** O que a rota `montar` devolve depois que ela deixou de ser stream. */
interface RespostaDaMontagem {
  grafo: FlowGraph;
  comExemplo: number;
  descartes: { o_que: string; motivo: string }[];
  consertos?: Conserto[];
  pendencias?: ErroDeGrafo[];
}

export interface UseGeracaoDeFluxo extends EstadoDaGeracao {
  /** ETAPA 1. Devolve o plano ao estado e PARA — quem manda montar é a pessoa. */
  planejar(pedido: string, historico: readonly Mensagem[]): Promise<void>;
  /** ETAPA 2. Só faz sentido depois de `planejar()`. */
  montar(pedido: string): Promise<void>;
  cancelar(): void;
  reiniciar(): void;
}

export function useGeracaoDeFluxo(
  flowId: string,
  aoMudarGrafo: (grafo: FlowGraph) => void,
): UseGeracaoDeFluxo {
  const [estado, setEstado] = React.useState<EstadoDaGeracao>(INICIAL);
  const abortRef = React.useRef<AbortController | null>(null);
  // O callback muda a cada render do pai; guardá-lo numa ref evita recriar
  // `planejar`/`montar` (e cancelar uma geração em curso) por causa disso.
  const aoMudarGrafoRef = React.useRef(aoMudarGrafo);
  aoMudarGrafoRef.current = aoMudarGrafo;
  // O plano vive também numa ref porque `montar()` é chamado de um `onClick` no
  // mesmo tique em que o estado acabou de ser escrito — ler do estado ali
  // pegaria o valor anterior.
  const planoRef = React.useRef<PlanoDeFluxo | null>(null);

  const cancelar = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    planoRef.current = null;
    setEstado(INICIAL);
  }, []);

  const reiniciar = React.useCallback(() => {
    planoRef.current = null;
    setEstado(INICIAL);
  }, []);

  React.useEffect(() => {
    // Sair da tela no meio da montagem não pode deixar a conexão pendurada.
    return () => abortRef.current?.abort();
  }, []);

  const planejar = React.useCallback(
    async (pedido: string, historico: readonly Mensagem[]) => {
      abortRef.current?.abort();
      const controle = new AbortController();
      abortRef.current = controle;
      setEstado({ ...INICIAL, fase: "planejando" });

      let plano: PlanoDeFluxo;
      try {
        const resposta = await apiClient.post<{ data: PlanoDeFluxo }>(
          `/api/v1/flows/${flowId}/ai/plano`,
          { pedido, historico },
          // O teto padrão do cliente é 10s, curto demais para esperar um
          // provedor de IA: a chamada era abandonada no meio e o que a pessoa
          // via não tinha relação com o que acontecia do outro lado.
          { timeoutMs: 120_000, signal: controle.signal },
        );
        plano = resposta.data;
      } catch (err) {
        if (controle.signal.aborted) return;
        setEstado({
          ...INICIAL,
          fase: "falhou",
          // A frase do servidor, não uma genérica nossa: é ela que distingue
          // "nenhum provedor configurado" (conserto de um clique) de "o modelo
          // recusou o pedido".
          erro: err instanceof Error ? err.message : "Não consegui planejar o fluxo.",
        });
        return;
      }

      if (controle.signal.aborted) return;
      planoRef.current = plano;
      setEstado({
        ...INICIAL,
        fase: "planejado",
        plano,
        total: plano.blocos.length,
      });
    },
    [flowId],
  );

  const montar = React.useCallback(
    async (pedido: string) => {
      const plano = planoRef.current;
      if (plano === null) return;

      const controle = new AbortController();
      abortRef.current = controle;

      // O esqueleto no canvas ANTES do primeiro config: é o que faz o fluxo
      // aparecer em segundos, e é o que sobra se a etapa 2 não voltar.
      const esqueleto = planoParaGrafo(plano, new Map<string, ConfigResolvida>());
      if (esqueleto.valido) aoMudarGrafoRef.current(esqueleto.grafo);

      setEstado((s) => ({
        ...s,
        fase: "montando",
        comExemplo: 0,
        grafo: esqueleto.valido ? esqueleto.grafo : null,
        erro: null,
        consertos: [],
        pendencias: [],
        somenteEsqueleto: false,
      }));

      try {
        const resposta = await apiClient.post<{ data: RespostaDaMontagem }>(
          `/api/v1/flows/${flowId}/ai/montar`,
          { pedido, plano },
          // Mais folgado que a etapa 1 porque aqui são N chamadas ao provedor,
          // quatro por vez: ~10s para 8 blocos, ~25s para 20. O teto existe para
          // a tela não ficar presa para sempre, não para cortar geração legítima.
          //
          // ⚠️ `semRepetir` NÃO É OPCIONAL AQUI. Sem ele, um estouro de teto faz
          // o `apiClient` tentar mais DUAS vezes: nove minutos de espera e três
          // gerações pagas no provedor para chegar ao mesmo lugar, com a pessoa
          // olhando uma tela parada. É o mesmo argumento que o cliente já faz
          // para o 502 das rotas de IA, aplicado ao timeout.
          { timeoutMs: 180_000, signal: controle.signal, semRepetir: true },
        );
        aoMudarGrafoRef.current(resposta.data.grafo);
        setEstado((s) => ({
          ...s,
          fase: "pronto",
          grafo: resposta.data.grafo,
          comExemplo: resposta.data.comExemplo,
          consertos: resposta.data.consertos ?? [],
          pendencias: resposta.data.pendencias ?? [],
          somenteEsqueleto: false,
        }));
      } catch (err) {
        if (controle.signal.aborted) return; // cancelamento não é falha
        setEstado((s) => ({
          ...s,
          fase: "falhou",
          erro: err instanceof Error ? err.message : "A montagem falhou no meio.",
          // O canvas NÃO é desfeito: o esqueleto continua lá, e a tela diz isso.
          somenteEsqueleto: esqueleto.valido,
          comExemplo: esqueleto.valido ? plano.blocos.length : 0,
        }));
      }
    },
    [flowId],
  );

  return { ...estado, planejar, montar, cancelar, reiniciar };
}
