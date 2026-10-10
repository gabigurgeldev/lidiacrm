/**
 * Simulação — a mesma decisão do runtime, sem NENHUM efeito.
 *
 * Usa `decidir` e `aplicarVeredito` (as mesmas funções da entrada real) sobre
 * uma política e um estado de conversa sintéticos que a tela monta. Não lê nem
 * escreve estado, não admite mensagem, não inicia fluxo, não envia, não mexe em
 * lead. O decisor, quando a simulação o usa, vai pelo mesmo seam (consome
 * orçamento, e a tela diz isso).
 */
import { aplicarVeredito, decidir, type FatosDaConversa, type Proposta } from "./decidir";
import type { CandidatoDoDecisor, Decisao, Decisor } from "./decisor/contrato";
import { estadoVazio, type DonoTipo } from "./estado";
import { rotuloDoMotivo } from "./motivos";
import type { DestinoEfetivo, PoliticaEfetiva } from "./politica/resolver";

export interface CenarioDeSimulacao {
  texto: string;
  /** Quem conduz no cenário (chave de destino) ou ninguém/pessoa. */
  dono: { tipo: DonoTipo; chave: string | null };
  humanoNoComando: boolean;
}

export interface ResultadoDaSimulacao {
  acao: Proposta["acao"];
  destino: { chave: string; nome: string; tipo: "agente" | "fluxo" } | null;
  categoria: string | null;
  motivo: string;
  motivo_legivel: string;
  usou_modelo: boolean;
  /** As regras não bastaram: a decisão real consultaria o modelo. */
  precisou_do_modelo: boolean;
  decisor: Pick<Decisao, "status" | "escolha" | "confianca" | "modelo" | "ms" | "custoCents"> | null;
}

function candidato(d: DestinoEfetivo): CandidatoDoDecisor {
  return { chave: d.chave, nome: d.nome, quando_usar: d.quando_usar, exemplos: d.exemplos, nao_usar: d.nao_usar };
}

export async function simular(args: {
  politica: PoliticaEfetiva;
  cenario: CenarioDeSimulacao;
  decisor: Decisor | null;
  organizationId: string;
}): Promise<ResultadoDaSimulacao> {
  const { politica, cenario } = args;
  const donoDestino = cenario.dono.chave ? politica.destinos.find((d) => d.chave === cenario.dono.chave) ?? null : null;
  const estado = {
    ...estadoVazio(args.organizationId, "00000000-0000-0000-0000-000000000000"),
    dono_tipo: cenario.dono.tipo,
    dono_agent_id: cenario.dono.tipo === "agente" ? donoDestino?.agent_id ?? null : null,
    dono_execution_id: cenario.dono.tipo === "fluxo" && donoDestino ? "00000000-0000-0000-0000-0000000000e0" : null,
  };
  const fatos: FatosDaConversa = {
    humanoNoComando: cenario.humanoNoComando,
    bloqueado: false,
    agenteFixadoLegado: null,
    fluxoVivoLegado: null,
    flowIdConduzindo: cenario.dono.tipo === "fluxo" ? donoDestino?.flow_id ?? null : null,
  };

  let proposta = decidir({ estado, politica, texto: cenario.texto, fatos });
  const precisouDoModelo = proposta.acao === "consultar_modelo";
  let decisao: Decisao | null = null;
  if (proposta.acao === "consultar_modelo") {
    const consulta = proposta;
    decisao = args.decisor
      ? await args.decisor.decidir({
          organizationId: args.organizationId,
          conversationId: estado.conversation_id,
          contactId: null,
          jobId: null,
          mensagem: cenario.texto,
          contexto: [],
          atual: consulta.atual ? candidato(consulta.atual) : null,
          candidatos: consulta.candidatos.map(candidato),
          timeoutMs: politica.config.limites.decisor_timeout_ms,
        })
      : null;
    proposta = aplicarVeredito(
      consulta,
      { escolha: decisao?.status === "ok" ? decisao.escolha : null, confianca: decisao?.confianca ?? null },
      politica,
    );
  }

  const destino =
    proposta.acao === "destino" || proposta.acao === "manter"
      ? { chave: proposta.destino.chave, nome: proposta.destino.nome, tipo: proposta.destino.tipo }
      : null;
  // Sem o modelo ligado na simulação, ninguém falhou: o modelo só não foi
  // perguntado. Dizer "o modelo de decisão falhou" aqui mandava quem testava
  // caçar um defeito que não existia — e escondia o que existia.
  const naoConsultado = precisouDoModelo && args.decisor === null;
  const motivo = naoConsultado
    ? "modelo_nao_consultado"
    : "motivo" in proposta
      ? proposta.motivo
      : "decisor_falhou";
  return {
    acao: proposta.acao,
    destino,
    categoria: proposta.acao === "destino" || proposta.acao === "manter" ? proposta.categoria : null,
    motivo,
    motivo_legivel: naoConsultado
      ? "Simulação sem o modelo: seguiu o destino padrão. Ligue “Consultar o modelo de verdade” para ver a escolha real."
      : rotuloDoMotivo(motivo),
    usou_modelo: decisao !== null,
    precisou_do_modelo: precisouDoModelo,
    decisor: decisao
      ? {
          status: decisao.status,
          escolha: decisao.escolha,
          confianca: decisao.confianca,
          modelo: decisao.modelo,
          ms: decisao.ms,
          custoCents: decisao.custoCents,
        }
      : null,
  };
}
