/**
 * AS CAPACIDADES DO CRM NO ENSAIO: MESMA VITRINE, NENHUMA EXECUÇÃO.
 *
 * Em produção, as capacidades marcadas no agente (mover card, marcar consulta,
 * ler a ficha…) executam pela ponte MCP (`edge/crm/mcp-tools.ts`), que fala com o
 * banco pelo cliente HTTP do Supabase — por FORA da conexão do turno. No ensaio,
 * o turno inteiro roda numa transação que é desfeita no fim; uma escrita pela
 * ponte escaparia dela e mexeria no CRM de verdade. Era exatamente o defeito do
 * botão Testar antigo (`lib/ai/runtime/tools.ts`): ensaiar criava lead e marcava
 * consulta reais.
 *
 * Então, no ensaio, o modelo recebe as MESMAS ferramentas — nome, descrição e
 * parâmetros iguais aos da produção, para o teste dizer como o agente decide —
 * mas nenhuma executa. Leitura inclusive: o contato do ensaio só existe dentro
 * da transação, e a ponte, de fora dela, não o enxergaria; uma leitura "real"
 * devolveria dado de outro lugar fingindo ser deste cliente.
 *
 * A tela mostra cada chamada como "simulada", com os argumentos que o agente
 * escolheu — que é a parte que o dono do negócio precisa conferir.
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';

import { getToolByName } from '@/lib/mcp/tools';
import { catalogEntry } from '@/lib/mcp/tools/catalog';

import { BLOCKED_TOOL_IDS } from '../edge/crm/mcp-tools';

/** O que a ferramenta simulada devolve ao modelo. */
export function resultadoSimulado(ferramenta: string, categoria: string) {
  return {
    ok: true,
    simulado: true,
    ferramenta,
    mensagem:
      categoria === 'read'
        ? 'ensaio: a consulta ao CRM não foi feita — siga a conversa com o que o cliente disse.'
        : 'ensaio: a ação foi registrada como feita, sem alterar o CRM.',
  };
}

/**
 * As ferramentas do catálogo, com os mesmos filtros da produção (bloqueadas do
 * turno, só-humano), mas com `execute` que apenas devolve o resultado simulado.
 */
export function capacidadesSimuladas(toolIds: readonly string[]): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const id of toolIds) {
    if (BLOCKED_TOOL_IDS.has(id)) continue;
    const def = getToolByName(id);
    if (!def) continue;
    if (catalogEntry(def.name)?.apenasHumano) continue;
    result[def.name] = tool({
      description: def.description,
      inputSchema: z.object(def.inputSchema as Record<string, z.ZodTypeAny>),
      execute: async () => resultadoSimulado(def.name, def.category),
    });
  }
  return result;
}
