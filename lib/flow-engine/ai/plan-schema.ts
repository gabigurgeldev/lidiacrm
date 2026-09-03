/**
 * Flow Engine — a ETAPA 1 da geração: o plano, sem nenhuma config.
 *
 * ═══ O que muda em relação ao schema de uma chamada só ═══
 *
 * O schema antigo (`generation-schema.ts`) pedia o grafo INTEIRO numa resposta:
 * `nodes` era um array de uma união de 11 variantes, cada uma com o
 * `configSchema` daquele tipo embutido. Medido: 8.645 bytes de JSON Schema, com
 * `anyOf` de 11. Contra ~250 bytes do worker de sentimento, que sempre funcionou.
 *
 * Aqui não há união nenhuma. `tipo` é `z.enum(tiposRegistrados())`, que emite
 * `{"type":"string","enum":[...]}` — a forma mais simples que um JSON Schema
 * tem, e a única que nenhum provedor de saída estruturada discute. O modelo
 * decide QUAIS blocos e em que ordem; COMO preencher cada um é a etapa 2, uma
 * chamada pequena por bloco, com o schema daquele tipo e de mais nenhum.
 *
 * ═══ Por que `intencao` existe ═══
 *
 * É a ponte entre as duas etapas. A etapa 2 pede o config de um bloco isolado,
 * e sem uma frase dizendo o que aquele bloco faz NESTE fluxo, o modelo teria de
 * inferir do rótulo — que é curto por natureza. `intencao` é o que carrega
 * "esperar 10 minutos porque o time combinou responder nesse prazo" adiante,
 * sem arrastar o grafo inteiro para dentro de cada chamada.
 *
 * ═══ `ramo` é rótulo, não `branch_id` ═══
 *
 * O plano ainda não sabe os `branch_id` reais: eles saem do config do
 * `logic.if`, que só existe depois da etapa 2. Então aqui a ligação nomeia o
 * ramo do jeito que uma pessoa nomearia ("Score alto"), e quem reconcilia isso
 * com o `saidas[].id` de verdade é `plan-to-graph.ts`. Pedir `branch_id` aqui
 * produziria arestas apontando para handles que não existem — grafo bonito na
 * tela e roteamento quebrado, que é o defeito que este motor foi feito para não
 * ter.
 *
 * Vigiado por `plan-schema-cabe-no-provedor.test.ts`.
 */
import { z } from "zod";

import { garantirNosRegistrados } from "../register-all";
import { tiposRegistrados } from "../registry";

/** Teto de blocos por plano. Acima disso não é fluxo, é programa. */
export const MAX_BLOCOS = 40;
export const MAX_LIGACOES = 80;

/**
 * O TETO DE TOKENS DE SAÍDA DO PLANO — e por que ele mora AQUI.
 *
 * ═══ O defeito que este número existe para não repetir ═══
 *
 * A rota pedia 1200, com o comentário "folgado para 40 blocos". Medido contra o
 * provedor real (OpenRouter, `anthropic/claude-sonnet-5`), a afirmação é falsa
 * por uma ordem de grandeza:
 *
 *   pedido curto  (8 blocos)   826 · 1043 · 1068 · 1096 · 1106 · 1166 tokens
 *   pedido normal (15 blocos)  4 de 4 rodadas CORTADAS em 1200; a que coube
 *                              num teto maior gastou 6006
 *
 * Ou seja: o pedido de exemplo raspava o teto (1166 de 1200) e QUALQUER pedido
 * de tamanho real estourava. O corte chega ao SDK como
 * `No object generated: could not parse the response` — uma frase que fala de
 * PARSE e não de teto —, e foi ela que mandou cinco correções seguidas
 * procurarem no schema, no provedor e no transporte. Não estava em nenhum dos
 * três: o produto pedia ao modelo menos espaço do que a própria resposta ocupa.
 *
 * Trocar de modelo nunca ajudou, e é por isso que "testei todos os modelos"
 * descreve exatamente o sintoma: o teto é nosso, não do provedor.
 *
 * ═══ Por que aqui, e não na rota ═══
 *
 * O teto é uma AFIRMAÇÃO SOBRE ESTE SCHEMA: quanto cabe numa resposta que
 * respeite `MAX_BLOCOS` e `MAX_LIGACOES`. Longe deles, ele volta a envelhecer
 * sozinho — foi o que aconteceu. Junto deles, mexer num obriga a olhar o outro.
 *
 * ═══ ⚠️ TETO ALTO NÃO CUSTA NADA ═══
 *
 * Esta é a confusão que produziu o 1200. Cobra-se pelo token GERADO, não pelo
 * autorizado: um plano de 6 blocos sob um teto de 6.000 custa exatamente o
 * mesmo que sob um teto de 1.200 — a diferença é que sob 1.200 ele não cabe.
 * "Economizar" apertando o teto não economiza um centavo; só quebra a feature.
 *
 * Quem decide o custo é o MODELO (ver `resolverCadeia`, que passou a começar
 * pelo barato) e o NÚMERO DE CHAMADAS, nunca este número.
 *
 * ═══ De onde sai o 6000 ═══
 *
 * Medido: 8 blocos e 7 ligações couberam em 714 tokens de saída, ou seja ~90
 * tokens por bloco somado à ligação que sai dele. O teto do schema é
 * `MAX_BLOCOS` = 40 e `MAX_LIGACOES` = 80:
 *
 *     40 × 90  +  80 × 30  =  6000
 *
 * Ou seja: este teto comporta o MAIOR plano que o schema permite. Não há mais
 * um limite escondido menor do que o limite declarado — que era exatamente o
 * defeito, e a razão de "criar fluxo com IA" falhar em pedido de tamanho real.
 *
 * E ele ainda não é a última palavra: `portaComFallback` sobe o teto uma vez
 * quando a resposta volta cortada, para o caso de um modelo mais verboso que os
 * medidos aqui.
 */
export const TOKENS_DO_PLANO = 6000;

export function montarSchemaDePlano() {
  garantirNosRegistrados();
  const tipos = tiposRegistrados();

  return z.object({
    blocos: z
      .array(
        z.object({
          id: z
            .string()
            .min(1)
            .max(64)
            .describe("Identificador curto e estável, ex.: 'n1', 'checa_score'. Único no plano."),
          tipo: z
            .enum(tipos as [string, ...string[]])
            .describe("Um dos tipos disponíveis. Nunca invente um tipo fora desta lista."),
          rotulo: z
            .string()
            .min(1)
            .max(80)
            .describe("O texto em português que aparece no bloco, na tela."),
          intencao: z
            .string()
            .min(1)
            .max(200)
            .describe(
              "O que este bloco faz NESTE fluxo, em uma frase. Inclua os valores que a pessoa " +
                "pediu (tempo de espera, texto da mensagem, nome da etiqueta) — é o que permite " +
                "preencher os campos do bloco depois.",
            ),
        }),
      )
      .min(1)
      .max(MAX_BLOCOS)
      .describe("Os blocos do fluxo, em ordem. O primeiro é sempre um gatilho (trigger)."),
    ligacoes: z
      .array(
        z.object({
          de: z.string().min(1).max(64).describe("id do bloco de origem."),
          para: z.string().min(1).max(64).describe("id do bloco de destino."),
          ramo: z
            .string()
            .max(60)
            .optional()
            .describe(
              "Só para blocos que decidem (logic.if): o RÓTULO da saída por onde esta ligação " +
                "passa, igual ao que você escreveu na intenção do bloco. Deixe vazio para a " +
                "saída padrão ('depois disso').",
            ),
        }),
      )
      .max(MAX_LIGACOES)
      .describe("As ligações entre os blocos."),
  });
}

export type SchemaDePlano = ReturnType<typeof montarSchemaDePlano>;
export type PlanoDeFluxo = z.infer<SchemaDePlano>;
export type BlocoDoPlano = PlanoDeFluxo["blocos"][number];
export type LigacaoDoPlano = PlanoDeFluxo["ligacoes"][number];
