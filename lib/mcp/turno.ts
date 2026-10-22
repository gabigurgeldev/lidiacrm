/**
 * O CONTEXTO DO TURNO dentro das ferramentas MCP — o que o modelo NÃO escolhe.
 *
 * ─── O defeito que este módulo fecha ─────────────────────────────────────────
 *
 * `crm_book_appointment` pede `contact_id`: quem vai ser atendido. Dentro de um
 * turno do agente essa resposta já existe — é a pessoa da conversa —, e mesmo
 * assim era o MODELO que a escrevia. Duas consequências, as duas medidas no
 * desenho e não hipotéticas:
 *
 *   - o modelo não tem o uuid do contato (ele não aparece na conversa), então ou
 *     ele o copia de algum retorno de ferramenta, ou o inventa;
 *   - copiado de uma listagem, ele pode ser o de OUTRA pessoa — a consulta sai
 *     marcada para quem não pediu, e o lembrete vai para o telefone errado.
 *
 * Aqui o turno preenche, e o modelo nem vê o campo. Não é instrução de prompt
 * ("use o contato da conversa"), é AUSÊNCIA: o que não está no schema não pode
 * ser escolhido errado.
 *
 * ─── Por que o schema da definição continua EXIGINDO `contact_id` ────────────
 *
 * Fora de turno (o servidor MCP externo, por token) não há conversa nenhuma, e
 * lá o chamador TEM de dizer de quem é a consulta. Por isso o campo segue
 * obrigatório em `lib/mcp/tools/agendamento.ts` — e é também o que o escopo de
 * funil (`funil_vem_do_contato`, `lib/leads/escopo-de-funil.ts`) lê. Só a VISÃO
 * do modelo dentro do turno perde o campo; o handler sempre o recebe.
 *
 * ─── Não é só quem é atendido: é também de quem se LÊ ────────────────────────
 *
 * `crm_list_appointments` também recebe o contato do turno, e os recortes que
 * alcançam a agenda da equipe somem (`CAMPOS_FECHADOS_NO_TURNO`) — senão a
 * conversa com um cliente listava os compromissos de outros.
 *
 * ─── Ordem na ponte (`lib/ai/runtime/tools.ts`) ──────────────────────────────
 *
 * `aplicarTurno` roda ANTES do gate de escopo de funil: o gate decide pelo
 * `contact_id`, e ele precisa ver o contato que VAI ser gravado, não um valor
 * que o modelo tenha tentado mandar.
 */
import type { z } from "zod";

import type { McpContext } from "./types";

/** Campos que o turno preenche, por ferramenta. */
export type CampoDoTurno = "contact_id" | "conversation_id";

export const CAMPOS_DO_TURNO: Readonly<Record<string, readonly CampoDoTurno[]>> = {
  crm_book_appointment: ["contact_id", "conversation_id"],
  // Listar no turno é "os horários DESTA pessoa": o contato vem da conversa.
  crm_list_appointments: ["contact_id"],
};

/**
 * Campos que, DENTRO do turno, somem do schema e são DESCARTADOS do que o
 * modelo mandou — sem valor do turno para pôr no lugar.
 *
 * ─── O vazamento que isto fecha ──────────────────────────────────────────────
 *
 * `crm_list_appointments` aceita recortes que alcançam a agenda da EQUIPE: um
 * dia inteiro, uma profissional, um responsável, um negócio. Num turno, o
 * modelo conversa com UM cliente, e esses recortes lhe entregavam os
 * compromissos (e o `contato_id`) de outros — que ele pode repetir na conversa.
 * Com `contact_id` injetado a listagem já fica restrita a esta pessoa (os
 * filtros são E), mas esconder os demais tira do modelo até a ideia de pedir:
 * o que não está no schema não é tentado.
 *
 * Fora do turno (servidor MCP externo, Operador) nada muda — lá a pergunta
 * "como está o dia da equipe?" é legítima.
 */
export const CAMPOS_FECHADOS_NO_TURNO: Readonly<Record<string, readonly string[]>> = {
  crm_list_appointments: ["lead_id", "dia", "owner_user_id", "professional_id"],
};

type Turno = NonNullable<McpContext["turno"]>;

function valorDoTurno(campo: CampoDoTurno, turno: Turno): string {
  return campo === "contact_id" ? turno.contactId : turno.conversationId;
}

/**
 * O shape que o MODELO vê. Sem turno, ou ferramenta sem campos do turno, é o
 * shape inteiro — a mesma referência, para que nada mude para quem não é afetado.
 */
export function shapeVisivel<S extends z.ZodRawShape>(
  nome: string,
  shape: S,
  turno: McpContext["turno"],
): z.ZodRawShape {
  const fora = camposForaDoModelo(nome);
  if (!turno || fora.length === 0) return shape;
  const visivel: Record<string, unknown> = {};
  for (const [chave, tipo] of Object.entries(shape)) {
    if (fora.includes(chave)) continue;
    visivel[chave] = tipo;
  }
  return visivel as z.ZodRawShape;
}

/** Tudo o que, no turno, o modelo não vê: os preenchidos e os fechados. */
function camposForaDoModelo(nome: string): readonly string[] {
  return [...(CAMPOS_DO_TURNO[nome] ?? []), ...(CAMPOS_FECHADOS_NO_TURNO[nome] ?? [])];
}

/**
 * Os argumentos que o HANDLER recebe: os do modelo, com os campos do turno
 * SOBRESCRITOS. Sobrescreve mesmo quando o modelo mandou algo — o valor dele não
 * é confiável para "quem é atendido", e a direção segura é a conversa.
 */
export function aplicarTurno(
  nome: string,
  args: Record<string, unknown>,
  turno: McpContext["turno"],
): Record<string, unknown> {
  if (!turno || camposForaDoModelo(nome).length === 0) return args;
  const preenchidos: Record<string, unknown> = { ...args };
  // Fechados SAEM, mesmo que o modelo os tenha mandado (ele não os vê, mas
  // pode tê-los copiado de um retorno anterior).
  for (const campo of CAMPOS_FECHADOS_NO_TURNO[nome] ?? []) delete preenchidos[campo];
  for (const campo of CAMPOS_DO_TURNO[nome] ?? []) preenchidos[campo] = valorDoTurno(campo, turno);
  return preenchidos;
}
