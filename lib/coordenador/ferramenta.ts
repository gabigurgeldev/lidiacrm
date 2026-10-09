/**
 * `solicitar_acao_do_coordenador` — a ferramenta com que o AGENTE pede uma
 * troca. Ele não troca: pede, e o coordenador confere e aplica.
 *
 * Só entra no turno quando o coordenador está conduzindo (política `active`) e
 * a política dá ao agente pelo menos um destino permitido (`permissoes`). Fora
 * disso o agente não vê a ferramenta — não há o que pedir.
 *
 * O que vem do modelo é só a INTENÇÃO (ação, chave do destino, objetivo).
 * Organização, conversa, agente e geração vêm do runtime, nunca dos argumentos:
 * um modelo manipulado não consegue mandar a conversa de outra pessoa para
 * outro lugar, nem agir com uma geração que não é a dele.
 *
 * Aceito o pedido, o turno do agente acabou: a geração subiu, e o gate
 * `coordenacao` recusa qualquer `send_message` seguinte.
 */
import { z } from "zod";

import type { Consulta } from "./banco";
import { chamarFluxo } from "./chamadas";
import { lerEstado, transicionar } from "./estado";
import { avaliarLimites, type TransicaoRecente } from "./limites";
import type { DestinoEfetivo, PoliticaEfetiva } from "./politica/resolver";

export const NOME_DA_FERRAMENTA_DO_COORDENADOR = "solicitar_acao_do_coordenador";

export const entradaDaFerramentaSchema = z.object({
  acao: z
    .enum(["chamar_fluxo", "transferir"])
    .describe(
      "chamar_fluxo: um fluxo faz uma etapa e a conversa VOLTA para você quando ele terminar. " +
        "transferir: a conversa passa de vez para o destino; você não volta.",
    ),
  destino: z.string().min(1).max(40).describe("a chave do destino, exatamente como aparece na lista"),
  objetivo: z.string().max(300).optional().describe("o que o destino deve resolver, em uma frase"),
});

export type EntradaDaFerramenta = z.infer<typeof entradaDaFerramentaSchema>;

export type RespostaDaFerramenta =
  | { ok: true; status: "aceito"; mensagem: string }
  | { ok: false; status: "recusado"; motivo: string; mensagem: string };

export interface ConcessaoDoAgente {
  organizationId: string;
  conversationId: string;
  agentId: string;
  agentVersionId: string | null;
  geracao: number;
  jobId: string;
}

export interface DestinosPermitidos {
  chamar: DestinoEfetivo[];
  transferir: DestinoEfetivo[];
}

/**
 * O que a política deixa ESTE agente pedir. Só destinos elegíveis (publicados,
 * ativos) e diferentes dele mesmo; chamar com retorno só para fluxo — a
 * chamada de agente com retorno ainda não existe, e oferecê-la seria prometer
 * uma volta que ninguém faz.
 */
export function destinosPermitidos(politica: PoliticaEfetiva, agentId: string): DestinosPermitidos {
  const eu = politica.destinos.find((d) => d.tipo === "agente" && d.agent_id === agentId);
  if (!eu) return { chamar: [], transferir: [] };
  const permissao = politica.config.permissoes[eu.chave];
  if (!permissao) return { chamar: [], transferir: [] };
  const porChave = (chaves: readonly string[]) =>
    chaves
      .map((c) => politica.destinos.find((d) => d.chave === c))
      .filter((d): d is DestinoEfetivo => d !== undefined && d.elegivel && d.chave !== eu.chave);
  return {
    chamar: porChave(permissao.pode_chamar).filter((d) => d.tipo === "fluxo"),
    transferir: porChave(permissao.pode_transferir).filter((d) => d.permite_conduzir),
  };
}

/** A descrição que o modelo lê — o catálogo de destinos vai nela. */
export function descricaoDaFerramenta(p: DestinosPermitidos): string {
  const linha = (d: DestinoEfetivo) => `- ${d.chave} (${d.nome}): ${d.quando_usar || "sem descrição"}`;
  const partes = [
    "Pede ao coordenador para passar esta conversa a outro fluxo ou agente. Use SÓ quando o pedido " +
      "do cliente é claramente de um destino abaixo; depois de aceito, NÃO envie mais nada e encerre o turno.",
  ];
  if (p.chamar.length > 0) partes.push(`Pode CHAMAR (a conversa volta para você):\n${p.chamar.map(linha).join("\n")}`);
  if (p.transferir.length > 0) partes.push(`Pode TRANSFERIR (de vez):\n${p.transferir.map(linha).join("\n")}`);
  return partes.join("\n\n");
}

async function recentes(db: Consulta, c: ConcessaoDoAgente, minutos: number): Promise<TransicaoRecente[]> {
  const { rows } = await db.query<TransicaoRecente>(
    `select para_tipo, para_id::text as para_id, categoria, status, created_at::text as created_at
       from public.coord_transicoes
      where organization_id = $1 and conversation_id = $2
        and created_at > now() - ($3 || ' minutes')::interval
      order by created_at asc`,
    [c.organizationId, c.conversationId, String(minutos)],
  );
  return rows;
}

async function ultimaMensagemDoCliente(db: Consulta, c: ConcessaoDoAgente): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.messages
      where organization_id = $1 and conversation_id = $2 and direction = 'inbound'
      order by sent_at desc, created_at desc, id desc limit 1`,
    [c.organizationId, c.conversationId],
  );
  return rows[0]?.id ?? null;
}

const recusa = (motivo: string, mensagem: string): RespostaDaFerramenta => ({
  ok: false,
  status: "recusado",
  motivo,
  mensagem,
});

/**
 * Executa o pedido. Nunca lança para o modelo: toda recusa volta como erro de
 * ENSINO, com o que fazer em seguida.
 */
export async function executarPedido(
  db: Consulta,
  politica: PoliticaEfetiva,
  concessao: ConcessaoDoAgente,
  pedido: EntradaDaFerramenta,
  agora: Date = new Date(),
): Promise<RespostaDaFerramenta> {
  const permitidos = destinosPermitidos(politica, concessao.agentId);
  const lista = pedido.acao === "chamar_fluxo" ? permitidos.chamar : permitidos.transferir;
  const destino = lista.find((d) => d.chave === pedido.destino);
  if (!destino) {
    return recusa(
      "destino_nao_permitido",
      `"${pedido.destino}" não é um destino que você pode ${pedido.acao === "chamar_fluxo" ? "chamar" : "transferir"}. ` +
        "Continue o atendimento você mesmo.",
    );
  }
  const destinoId = destino.agent_id ?? destino.flow_id ?? "";
  const limite = avaliarLimites({
    recentes: await recentes(db, concessao, politica.config.limites.janela_minutos),
    limites: politica.config.limites,
    agora,
    proposta: { para_tipo: destino.tipo, para_id: destinoId, categoria: "delegacao" },
  });
  if (!limite.ok) {
    return recusa(limite.motivo, "Esta conversa já mudou de mãos vezes demais agora. Continue você mesmo o atendimento.");
  }

  const chave = `${concessao.jobId}:${pedido.acao}:${destino.chave}`;

  if (destino.tipo === "fluxo") {
    const r = await chamarFluxo(db, {
      organizationId: concessao.organizationId,
      conversationId: concessao.conversationId,
      origemAgentId: concessao.agentId,
      origemAgentVersionId: concessao.agentVersionId,
      geracaoOrigem: concessao.geracao,
      flowId: destino.flow_id!,
      modalidade: pedido.acao === "chamar_fluxo" ? "retorno" : "definitiva",
      input: pedido.objetivo ? { objetivo: pedido.objetivo } : {},
      objetivo: pedido.objetivo ?? null,
      chaveIdempotencia: chave,
      prazoHoras: politica.config.limites.prazo_chamada_horas,
      politicaVersaoId: politica.versao_id,
    });
    if (!r.ok) {
      return recusa(r.motivo, "O coordenador não aceitou a troca agora. Continue você mesmo o atendimento.");
    }
    return {
      ok: true,
      status: "aceito",
      mensagem:
        pedido.acao === "chamar_fluxo"
          ? `O fluxo "${destino.nome}" assumiu esta etapa e a conversa volta para você quando ele terminar. Não envie mais nada agora; encerre o turno.`
          : `A conversa passou para o fluxo "${destino.nome}". Não envie mais nada; encerre o turno.`,
    };
  }

  // Transferir para outro agente: a troca pela porta única, com o turno do
  // novo agente despachado na mesma transação.
  const estado = await lerEstado(db, concessao.organizationId, concessao.conversationId);
  if (!estado || estado.dono_tipo !== "agente" || estado.dono_agent_id !== concessao.agentId) {
    return recusa("nao_e_o_dono", "Esta conversa não está mais com você. Não envie mais nada; encerre o turno.");
  }
  if (estado.geracao !== concessao.geracao) {
    return recusa("geracao_obsoleta", "Esta conversa mudou enquanto você respondia. Não envie mais nada; encerre o turno.");
  }
  const mensagem = await ultimaMensagemDoCliente(db, concessao);
  const conversa = await db.query<{ contact_id: string; channel_session_id: string }>(
    `select contact_id, channel_session_id from public.conversations where organization_id = $1 and id = $2`,
    [concessao.organizationId, concessao.conversationId],
  );
  const linha = conversa.rows[0];
  const r = await transicionar(db, {
    organizationId: concessao.organizationId,
    conversationId: concessao.conversationId,
    versaoEsperada: estado.versao,
    para: { tipo: "agente", agentId: destino.agent_id!, agentVersionId: destino.agent_version_id },
    situacao: "ativo",
    categoria: "delegacao",
    motivo: "agente_transferiu",
    politicaVersaoId: politica.versao_id,
    despacho:
      mensagem && linha
        ? {
            event_type: "ai_agent.dispatch_requested",
            payload: {
              conversation_id: concessao.conversationId,
              contact_id: linha.contact_id,
              channel_session_id: linha.channel_session_id,
              inbound_message_id: mensagem,
              imediato: true,
            },
          }
        : null,
    detalhe: pedido.objetivo ? { objetivo: pedido.objetivo.slice(0, 300) } : {},
  });
  if (!r.ok) {
    return recusa(r.motivo, "O coordenador não aceitou a troca agora. Não envie mais nada; encerre o turno.");
  }
  return {
    ok: true,
    status: "aceito",
    mensagem: `A conversa passou para "${destino.nome}". Não envie mais nada; encerre o turno.`,
  };
}
