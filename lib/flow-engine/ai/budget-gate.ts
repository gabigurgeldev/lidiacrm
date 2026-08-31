/**
 * Flow Engine — o portão de orçamento antes de gastar token com IA.
 *
 * ═══ Por que isto existe, e por que aqui e não no seam ═══
 *
 * O seam do agente (`lib/agent-engine/edge/llm/run-model-call.ts`) já verifica
 * orçamento, mas fala `pg.Pool` — os workers antigos (e esta feature) falam
 * Supabase dentro de uma Route Handler. Este arquivo é a ponte mínima:
 * reusa a MESMA função pura de decisão (`decidirOrcamento`) e a MESMA leitura
 * canônica (`getBudgetStatus`, que já lê pela régua única
 * `fn_gasto_de_ia_do_mes`) — nunca uma terceira régua.
 *
 * ═══ Por que um gate NOVO, e não confiar no `resolverModeloDoPonto` sozinho ═══
 *
 * `resolverModeloDoPonto` resolve QUAL modelo usar; ele não pergunta se a
 * organização ainda PODE gastar. Sem este gate, um manager clicando "Criar com
 * IA" repetidamente geraria fluxo o dia inteiro e só descobriria o teto
 * estourado no card de Uso de IA, dias depois — silêncio exatamente onde o
 * clique é humano e o feedback deveria ser imediato.
 *
 * ═══ O que é DELIBERADAMENTE simplificado em relação ao gate do seam ═══
 *
 * O gate do seam também abre um item na Central (`agent_inbox_items`,
 * `budget_exceeded`) e registra "já avisou este mês" para não repetir o aviso.
 * Essa contabilidade serve ao caso de fundo — automação rodando sem ninguém
 * olhando. Aqui há uma PESSOA na tela esperando a resposta: a recusa direta na
 * chamada já é o aviso, e replicar a abertura de item na Central duplicaria o
 * alerta sem ninguém a mais para ler.
 */
import {
  decidirOrcamento,
  normalizarChaveDeOrcamento,
} from "@/lib/agent-engine/edge/llm/orcamento";
import { getBudgetStatus } from "@/lib/ai/budget/check";
import { env } from "@/lib/env";

export interface VeredictoDeOrcamento {
  permitido: boolean;
  /** Só quando `permitido: false` — frase pronta para a tela, em pt-BR. */
  motivo?: string;
}

/**
 * `purpose` entra só para casar a assinatura de `decidirOrcamento` — os dois
 * pontos de geração de fluxo (`flow_ai_interpretar`, `flow_ai_gerar`) NÃO
 * estão em `PURPOSES_ISENTOS`, então o teto vale para os dois igualmente.
 */
export async function orcamentoPermite(
  organizationId: string,
  purpose: string,
): Promise<VeredictoDeOrcamento> {
  const status = await getBudgetStatus(organizationId);

  const veredito = decidirOrcamento({
    modo: status.enforcement_mode,
    tetoCents: status.monthly_limit_cents,
    gastoCents: status.current_month_consumed_cents,
    efetivoEm: status.enforcement_effective_at ? new Date(status.enforcement_effective_at) : null,
    agora: new Date(),
    purpose,
    chave: normalizarChaveDeOrcamento(env.AI_BUDGET_ENFORCEMENT),
    limiarPct: status.alarm_threshold_pct,
    // Não distinguimos "primeiro cruzamento" de "limiar de novo" aqui: as
    // duas caem em `avisar_e_seguir`, que este gate trata igual (permite). A
    // diferença entre elas só importa para o aviso que o seam abre na
    // Central, que este gate não replica (ver o cabeçalho do arquivo).
    avisadoNesteMes: true,
  });

  if (veredito.acao === "bloquear") {
    return {
      permitido: false,
      motivo:
        "O orçamento de IA deste mês já foi atingido. Aumente o teto em Uso de IA › Orçamento, ou espere o mês virar.",
    };
  }
  return { permitido: true };
}
