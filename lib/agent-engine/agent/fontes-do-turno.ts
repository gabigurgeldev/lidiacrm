/**
 * O que conta como FONTE de fato da empresa num turno — e o registro do que as
 * ferramentas devolveram, para o gate de fundamentação conferir.
 *
 * Resultado de ferramenta é fonte: o catálogo que a integração consultou, o
 * pedido que o CRM devolveu, a agenda livre. Mas nem toda ferramenta: as de
 * FALAR (o resultado delas é o status do envio), a passagem, a busca (os trechos
 * já entram por outro caminho, só os acima do limiar), a releitura do contexto
 * (traz a fala do CLIENTE, que não é fonte de fato da empresa — ver
 * `grounding.ts`) e a referência de skill (orientação de conduta, não fato).
 */
import type { ToolSet } from 'ai';

export const FERRAMENTAS_QUE_NAO_SAO_FONTE: ReadonlySet<string> = new Set([
  'send_message',
  'send_template',
  'send_options',
  'request_human_handoff',
  'search_knowledge',
  'get_lead_context',
  'read_skill_reference',
]);

/** Teto por resultado: um catálogo inteiro não precisa entrar para conferir uma frase. */
const TETO_POR_RESULTADO = 20_000;

/**
 * Envolve cada ferramenta para entregar o resultado a `aoResultado`. O resultado
 * volta ao modelo INTACTO — isto só observa. Falha da ferramenta segue como era.
 */
export function registrarResultados(tools: ToolSet, aoResultado: (texto: string) => void): ToolSet {
  const saida: ToolSet = {};
  for (const [nome, t] of Object.entries(tools)) {
    const executar = t.execute;
    if (FERRAMENTAS_QUE_NAO_SAO_FONTE.has(nome) || executar === undefined) {
      saida[nome] = t;
      continue;
    }
    saida[nome] = {
      ...t,
      execute: async (...args: Parameters<typeof executar>) => {
        const resultado: unknown = await executar(...args);
        try {
          const texto = typeof resultado === 'string' ? resultado : JSON.stringify(resultado);
          if (texto) aoResultado(texto.slice(0, TETO_POR_RESULTADO));
        } catch {
          // Resultado não serializável não é fonte conferível — e não pode
          // derrubar a ferramenta que funcionou.
        }
        return resultado;
      },
    } as typeof t;
  }
  return saida;
}
