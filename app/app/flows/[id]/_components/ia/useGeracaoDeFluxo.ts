"use client";

/**
 * As duas etapas, do lado do browser.
 *
 * ═══ Por que o `plano` passa pelo `apiClient` e o `montar` não ═══
 *
 * A etapa 1 é uma resposta JSON comum: o `apiClient` já sabe repetir o que vale
 * a pena, respeitar `Retry-After` e transformar o corpo de erro numa frase
 * legível. A etapa 2 é um stream, e stream não passa por wrapper de JSON — ali
 * o `fetch` é direto, com `AbortController` próprio.
 *
 * ═══ O que a tela ganha ═══
 *
 * O canvas recebe o ESQUELETO INTEIRO assim que o plano chega (segundos), e
 * depois cada bloco "acende" quando o config dele fica pronto. No caminho
 * anterior os nós pingavam um a um durante todo o tempo da chamada e, se algo
 * falhasse no fim, todos sumiam de uma vez.
 */
import * as React from "react";

import { apiClient } from "@/lib/api/client";
import type { PlanoDeFluxo } from "@/lib/flow-engine/ai/plan-schema";
import { planoParaGrafo, type ConfigResolvida } from "@/lib/flow-engine/ai/plan-to-graph";
import type { FlowGraph } from "@/lib/flow-engine/graph-schema";

import { lerEventos } from "./lerEventos";

export type FaseDaGeracao = "parado" | "planejando" | "montando" | "pronto" | "falhou";

export interface Mensagem {
  papel: "usuario" | "ia";
  texto: string;
}

export interface EstadoDaGeracao {
  fase: FaseDaGeracao;
  plano: PlanoDeFluxo | null;
  /** Blocos já preenchidos, para a barra de progresso. */
  concluidos: number;
  total: number;
  /** Quantos ficaram com valores padrão — a tela AVISA, não esconde. */
  comExemplo: number;
  grafo: FlowGraph | null;
  erro: string | null;
}

const INICIAL: EstadoDaGeracao = {
  fase: "parado",
  plano: null,
  concluidos: 0,
  total: 0,
  comExemplo: 0,
  grafo: null,
  erro: null,
};

export interface UseGeracaoDeFluxo extends EstadoDaGeracao {
  iniciar(pedido: string, historico: readonly Mensagem[]): Promise<void>;
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
  // `iniciar` (e cancelar uma geração em curso) por causa disso.
  const aoMudarGrafoRef = React.useRef(aoMudarGrafo);
  aoMudarGrafoRef.current = aoMudarGrafo;

  const cancelar = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setEstado(INICIAL);
  }, []);

  const reiniciar = React.useCallback(() => setEstado(INICIAL), []);

  React.useEffect(() => {
    // Sair da tela no meio da montagem não pode deixar a conexão pendurada.
    return () => abortRef.current?.abort();
  }, []);

  const iniciar = React.useCallback(
    async (pedido: string, historico: readonly Mensagem[]) => {
      abortRef.current?.abort();
      const controle = new AbortController();
      abortRef.current = controle;
      setEstado({ ...INICIAL, fase: "planejando" });

      // ── ETAPA 1 ────────────────────────────────────────────────────────────
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

      // O esqueleto no canvas ANTES do primeiro config: é o que faz o fluxo
      // aparecer em segundos em vez de gotejar por um minuto.
      const configs = new Map<string, ConfigResolvida>();
      const esqueleto = planoParaGrafo(plano, configs);
      if (esqueleto.valido) aoMudarGrafoRef.current(esqueleto.grafo);

      setEstado({
        fase: "montando",
        plano,
        concluidos: 0,
        total: plano.blocos.length,
        comExemplo: 0,
        grafo: esqueleto.valido ? esqueleto.grafo : null,
        erro: null,
      });

      // ── ETAPA 2 ────────────────────────────────────────────────────────────
      try {
        const resposta = await fetch(`/api/v1/flows/${flowId}/ai/montar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedido, plano }),
          signal: controle.signal,
        });

        if (!resposta.ok || resposta.body === null) {
          // Erro ANTES do stream: ainda é JSON, e a causa está nele.
          const corpo = (await resposta.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setEstado((s) => ({
            ...s,
            fase: "falhou",
            erro: corpo?.error?.message ?? "A montagem falhou antes de começar.",
          }));
          return;
        }

        for await (const evento of lerEventos(resposta.body, controle.signal)) {
          if (evento.tipo === "bloco") {
            setEstado((s) => ({
              ...s,
              concluidos: s.concluidos + 1,
              comExemplo: s.comExemplo + (evento.origem === "exemplo" ? 1 : 0),
            }));
            continue;
          }
          if (evento.tipo === "grafo") {
            aoMudarGrafoRef.current(evento.grafo);
            setEstado((s) => ({ ...s, grafo: evento.grafo }));
            continue;
          }
          if (evento.tipo === "fim") {
            setEstado((s) => ({
              ...s,
              fase: "pronto",
              concluidos: s.total,
              comExemplo: evento.comExemplo,
            }));
            continue;
          }
          if (evento.tipo === "erro") {
            setEstado((s) => ({ ...s, fase: "falhou", erro: evento.mensagem }));
          }
        }
      } catch (err) {
        if (controle.signal.aborted) return; // cancelamento não é falha
        setEstado((s) => ({
          ...s,
          fase: "falhou",
          erro: err instanceof Error ? err.message : "A montagem falhou no meio.",
        }));
      }
    },
    [flowId],
  );

  return { ...estado, iniciar, cancelar, reiniciar };
}
