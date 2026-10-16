/**
 * Materiais que TODO agente da organização consulta (migration 0245,
 * `ai_knowledge_sources.todos_os_agentes`).
 *
 * O agente busca nos materiais que a versão publicada escolheu — e a versão
 * publicada é imutável. As respostas que o dono ensina pela Central de lacunas
 * não podem esperar uma republicação de cada agente: entram num material da
 * organização marcado como "de todos", e esta leitura o soma à lista do agente
 * em cada turno.
 *
 * Falha de leitura (clone que ainda não aplicou a 0245, banco lento) devolve
 * lista vazia: o agente segue com os materiais dele, como antes.
 */
import type { Queryable } from '../queue/queue';

export async function lerFontesDeTodosOsAgentes(db: Queryable, organizationId: string): Promise<string[]> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `select id
         from ai_knowledge_sources
        where organization_id = $1
          and todos_os_agentes
          and is_active
          and status = 'ready'`,
      [organizationId],
    );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * A lista final de materiais do turno. O caminho LEGADO (agente sem lista, só
 * com o ponteiro `kbVersionId`) fica intocado: somar uma fonte ali trocaria a
 * busca do índice antigo pela busca por materiais e calaria o acervo dele.
 */
export function materiaisDoTurno(input: {
  doAgente: readonly string[];
  deTodos: readonly string[];
  temIndiceLegado: boolean;
}): string[] {
  if (input.doAgente.length === 0 && input.temIndiceLegado) return [...input.doAgente];
  return [...new Set([...input.doAgente, ...input.deTodos])];
}
