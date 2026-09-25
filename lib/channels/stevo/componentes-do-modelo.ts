/**
 * Os `components[]` de um envio por definição aprovada — pelo CONTRATO, e não
 * pelas chaves, sempre que a definição for achável.
 *
 * ─── O defeito que isto fecha ──────────────────────────────────────────────
 *
 * O envio deste canal montava o payload só com `componentsPorChave`, que não tem
 * como saber o TIPO de uma lacuna: `header:1` sai como texto. Um modelo com
 * imagem no cabeçalho era recusado pela Meta em toda mensagem
 * (`Format mismatch, expected IMAGE`) — e num disparo isso só aparece destinatário
 * a destinatário, depois de a campanha começar.
 *
 * `buildComponents` sabe o tipo porque parte do contrato derivado da definição.
 * O que faltava era a definição chegar até aqui.
 *
 * ─── De onde vem a definição, em ordem ─────────────────────────────────────
 *
 *   1. O espelho (`meta_templates`) — sem rede, é o caminho normal depois de
 *      sincronizar.
 *   2. A própria plataforma — o espelho pode estar vazio: a tela de modelos e o
 *      seletor do disparo leem direto dela quando ele está. Guardada em memória
 *      por alguns minutos: um disparo de 500 contatos não pode virar 500
 *      listagens.
 *   3. Nenhuma das duas respondeu: `componentsPorChave`, que cobre corpo e
 *      cabeçalho de texto e falha alto no resto — melhor que não enviar.
 */
import { componentsPorChave } from "../cloud-api/template-por-chaves";
import { buildComponents, type MetaSendComponent } from "../meta/build-components";
import { deriveTemplateContract } from "../meta/template-contract";
import type { ChannelTemplate } from "../types";

export interface DefinicaoParaEnvio {
  name: string;
  language: string;
  parameterFormat?: string | null;
  components: unknown[];
}

/** Quanto tempo a definição lida da plataforma vale em memória. */
export const VALIDADE_DO_CACHE_MS = 5 * 60_000;

const cache = new Map<string, { lidaEm: number; definicao: DefinicaoParaEnvio | null }>();

/** Só para teste. */
export function __limparCacheDeDefinicoes(): void {
  cache.clear();
}

export async function componentesDoModelo(
  deps: {
    /** Identifica a definição NESTA conexão: org, conexão, nome e idioma. */
    chave: string;
    lerEspelho: () => Promise<DefinicaoParaEnvio | null>;
    listarNaPlataforma: () => Promise<ChannelTemplate[]>;
    agora?: number;
  },
  pedido: { name: string; language: string; values: Record<string, string> },
): Promise<MetaSendComponent[]> {
  const definicao = await acharDefinicao(deps, pedido);
  if (!definicao) return componentsPorChave(pedido.values);

  const contrato = deriveTemplateContract({
    name: definicao.name,
    language: definicao.language,
    parameter_format: definicao.parameterFormat ?? undefined,
    components: definicao.components as never,
  });
  // Lança quando falta valor, com o nome da lacuna — o erro fica gravado na
  // mensagem, onde o operador lê, em vez de um 132000 da Meta.
  return buildComponents(contrato, pedido.values);
}

async function acharDefinicao(
  deps: Parameters<typeof componentesDoModelo>[0],
  pedido: { name: string; language: string },
): Promise<DefinicaoParaEnvio | null> {
  // Falha de leitura do espelho não é "não existe": segue para a plataforma.
  const doEspelho = await deps.lerEspelho().catch(() => null);
  if (doEspelho) return doEspelho;

  const agora = deps.agora ?? Date.now();
  const guardada = cache.get(deps.chave);
  if (guardada && agora - guardada.lidaEm < VALIDADE_DO_CACHE_MS) return guardada.definicao;

  try {
    const remotas = await deps.listarNaPlataforma();
    const achada = remotas.find((t) => t.name === pedido.name && t.language === pedido.language);
    const definicao: DefinicaoParaEnvio | null = achada
      ? {
          name: achada.name,
          language: achada.language,
          parameterFormat: achada.parameterFormat ?? null,
          components: achada.components ?? [],
        }
      : null;
    // "Não achei" também vai para o cache: sem isso, um nome que a plataforma não
    // conhece custaria uma listagem por destinatário.
    cache.set(deps.chave, { lidaEm: agora, definicao });
    return definicao;
  } catch {
    // Plataforma fora do ar: não guarda nada, e a próxima mensagem tenta de novo.
    return null;
  }
}
