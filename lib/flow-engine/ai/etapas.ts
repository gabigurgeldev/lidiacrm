/**
 * Flow Engine — a orquestração das duas etapas da geração.
 *
 * ═══ A regra que define este arquivo ═══
 *
 * FALHA DE UM BLOCO NÃO DERRUBA OS IRMÃOS. É a diferença entre esta geração e a
 * anterior, e não é detalhe de robustez: no caminho antigo o grafo inteiro
 * chegava numa resposta só, validada contra um `z.strictObject` por tipo, então
 * um único `config` divergente entre vinte blocos apagava TUDO — 59 nós
 * perfeitos e 1 defeituoso davam zero nós, e a pessoa via "a IA não conseguiu
 * terminar o fluxo" sem saber que 59 estavam prontos.
 *
 * Aqui cada bloco é uma chamada pequena. A que falhar duas vezes cai no
 * `configExemploDoTipo` e o fluxo segue — com a tela dizendo quantos blocos
 * ficaram com valores padrão, porque esconder isso seria repetir o pecado de
 * parecer que funcionou.
 *
 * ═══ Concorrência ═══
 *
 * Quatro por vez. Não é um número mágico: é o que mantém um fluxo de 20 blocos
 * abaixo de meio minuto sem transformar a geração num pico de 20 chamadas
 * simultâneas ao provedor — que é o caminho mais curto para um 429 que derruba
 * blocos por motivo nenhum.
 *
 * A porta do modelo é INJETADA. Todo este arquivo é testável sem rede, e é o
 * que permite provar a aceitação parcial de verdade em vez de confiar nela.
 */
import { z } from "zod";

import { schemaDeConfigParaGeracao } from "./config-para-geracao";
import type { PortaDeModelo } from "./modelo-com-fallback";
import type { BlocoDoPlano, PlanoDeFluxo } from "./plan-schema";
import type { ConfigResolvida } from "./plan-to-graph";
import { promptDeConfig, promptDoBloco } from "./prompt";
import { configExemploDoTipo } from "../node-examples";
import { garantirNosRegistrados } from "../register-all";
import { buscarNo } from "../registry";

export const CONCORRENCIA_PADRAO = 4;
/** Uma tentativa e uma repetição. Além disso é dinheiro gasto para esperar mais. */
export const TENTATIVAS_POR_BLOCO = 2;
export const TOKENS_POR_CONFIG = 800;

export interface EventoDeBloco {
  id: string;
  resolvida: ConfigResolvida;
  restantes: number;
}

/**
 * O que as dezenas de chamadas pequenas somaram — para a rota LOGAR.
 *
 * Sem isto, a rota de montagem não veria `finishReason` de chamada nenhuma
 * (quem chama é a porta), e o único caminho para satisfazer a cerca de
 * observabilidade seria escrever um valor de enfeite. Agregado, o campo diz
 * mais do que diria por chamada: um punhado de `"length"` entre os configs
 * acusa teto de tokens curto, e `warnings` repetido acusa provedor ignorando
 * o `response_format` — as duas causas que custaram deploys.
 */
export interface TelemetriaDosConfigs {
  /** Quantas chamadas terminaram com cada `finishReason`. */
  finishReasons: Record<string, number>;
  /** Avisos distintos do provedor, no máximo 5. */
  warnings: string[];
  /** Blocos que caíram no exemplo depois de esgotar as tentativas. */
  comExemplo: number;
  chamadas: number;
}

export interface ResultadoDasEtapas {
  configs: Map<string, ConfigResolvida>;
  telemetria: TelemetriaDosConfigs;
}

/** Uma frase curta dizendo onde o bloco fica — o contexto mínimo da etapa 2. */
function vizinhosDe(plano: PlanoDeFluxo, bloco: BlocoDoPlano): string {
  const rotulo = (id: string) =>
    plano.blocos.find((b) => b.id === id)?.rotulo ?? id;
  const antes = plano.ligacoes.filter((l) => l.para === bloco.id).map((l) => rotulo(l.de));
  const depois = plano.ligacoes.filter((l) => l.de === bloco.id).map((l) => rotulo(l.para));
  const partes: string[] = [];
  if (antes.length > 0) partes.push(`vem depois de ${antes.join(", ")}`);
  if (depois.length > 0) partes.push(`e leva a ${depois.join(", ")}`);
  return partes.length > 0 ? partes.join(" ") : "é o primeiro bloco do fluxo";
}

/**
 * Os rótulos de ramo que o PLANO já decidiu para as ligações saindo deste bloco.
 *
 * Sem eles a etapa 2 inventa os seus, e os dois lados não casam — o defeito
 * inteiro está no cabeçalho de `promptDoBloco`. A ordem é a das ligações no
 * plano, que é a mesma ordem em que `resolverRamo` faz o desempate posicional:
 * as duas regras passam a concordar por construção em vez de por sorte.
 */
function ramosDoBloco(plano: PlanoDeFluxo, bloco: BlocoDoPlano): string[] {
  const vistos = new Set<string>();
  const ramos: string[] = [];
  for (const ligacao of plano.ligacoes) {
    if (ligacao.de !== bloco.id) continue;
    const ramo = ligacao.ramo?.trim();
    if (!ramo || vistos.has(ramo)) continue;
    vistos.add(ramo);
    ramos.push(ramo);
  }
  return ramos;
}

async function configDeUmBloco(
  porta: PortaDeModelo,
  plano: PlanoDeFluxo,
  bloco: BlocoDoPlano,
  pedido: string,
  telemetria: TelemetriaDosConfigs,
  sinal?: AbortSignal,
): Promise<ConfigResolvida> {
  const def = buscarNo(bloco.tipo);
  const exemplo = () => ({
    config: configExemploDoTipo(bloco.tipo),
    origem: "exemplo" as const,
  });

  if (def === undefined) return { ...exemplo(), causa: "tipo desconhecido" };

  const schema = schemaDeConfigParaGeracao(bloco.tipo);
  // Tipo sem campo nenhum (`trigger.lead_created`) não vale uma chamada paga
  // para receber `{}` de volta — e parte dos provedores recusa um objeto sem
  // propriedades. Vai direto para o exemplo, que para esses tipos É a resposta.
  if (schema === null) return { config: configExemploDoTipo(bloco.tipo), origem: "ia" };

  let ultimaCausa: string | undefined;
  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_BLOCO; tentativa += 1) {
    if (sinal?.aborted) break;
    const resultado = await porta.objeto<Record<string, unknown>>({
      schema: schema as z.ZodType<Record<string, unknown>>,
      system: promptDeConfig(bloco.tipo, def.rotulo, def.descricao),
      prompt: promptDoBloco({
        pedido,
        rotulo: bloco.rotulo,
        intencao: bloco.intencao,
        vizinhos: vizinhosDe(plano, bloco),
        ramos: ramosDoBloco(plano, bloco),
      }),
      maxOutputTokens: TOKENS_POR_CONFIG,
      rotulo: `${bloco.id}:${bloco.tipo}`,
      sinal,
    });
    telemetria.chamadas += 1;
    const razao = resultado.finishReason ?? (resultado.ok ? "desconhecido" : "erro");
    telemetria.finishReasons[razao] = (telemetria.finishReasons[razao] ?? 0) + 1;
    for (const aviso of resultado.avisos) {
      if (telemetria.warnings.length < 5 && !telemetria.warnings.includes(aviso)) {
        telemetria.warnings.push(aviso);
      }
    }
    if (resultado.ok && resultado.objeto) {
      return { config: resultado.objeto, origem: "ia" };
    }
    ultimaCausa = resultado.causa;
  }

  return { ...exemplo(), causa: ultimaCausa ?? "sem resposta utilizável" };
}

/**
 * Preenche o config de todos os blocos, com concorrência limitada.
 *
 * `aoConcluir` é chamado a cada bloco pronto — é o que vira evento SSE e faz o
 * bloco "acender" no canvas. Ele NÃO pode lançar: um erro ali derrubaria a
 * geração inteira por causa da tela, que é o rabo abanando o cachorro.
 */
export async function gerarConfigs(
  porta: PortaDeModelo,
  plano: PlanoDeFluxo,
  pedido: string,
  opcoes: { concorrencia?: number; sinal?: AbortSignal } = {},
  aoConcluir?: (evento: EventoDeBloco) => void,
): Promise<ResultadoDasEtapas> {
  garantirNosRegistrados();
  const concorrencia = Math.max(1, opcoes.concorrencia ?? CONCORRENCIA_PADRAO);
  const resultados = new Map<string, ConfigResolvida>();
  const telemetria: TelemetriaDosConfigs = {
    finishReasons: {},
    warnings: [],
    comExemplo: 0,
    chamadas: 0,
  };
  const fila = [...plano.blocos];
  let restantes = fila.length;

  async function trabalhador(): Promise<void> {
    for (;;) {
      const bloco = fila.shift();
      if (bloco === undefined) return;
      const resolvida = await configDeUmBloco(
        porta,
        plano,
        bloco,
        pedido,
        telemetria,
        opcoes.sinal,
      );
      if (resolvida.origem === "exemplo") telemetria.comExemplo += 1;
      resultados.set(bloco.id, resolvida);
      restantes -= 1;
      try {
        aoConcluir?.({ id: bloco.id, resolvida, restantes });
      } catch {
        // A tela não pode derrubar a geração. Ver o cabeçalho desta função.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concorrencia, fila.length) }, () => trabalhador()),
  );
  return { configs: resultados, telemetria };
}
