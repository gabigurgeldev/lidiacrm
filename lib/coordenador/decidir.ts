/**
 * A decisão de quem conduz — regra PURA, sem I/O.
 *
 * Ordem (ADR 0002 §8 do pedido), e cada degrau existe para que o seguinte só
 * rode quando precisa:
 *
 *   1. governança: contato bloqueado ou pessoa no comando → nada automático;
 *   2. continuidade: fluxo conduzindo → a mensagem é dele;
 *   3. regra explícita publicada que casa de forma inequívoca → destino;
 *   4. continuidade do agente atual quando não há ambiguidade (mensagem curta,
 *      um só candidato, modelo desligado);
 *   5. modelo, só entre os elegíveis, e só quando os degraus acima não bastam;
 *   6. fallback declarado.
 *
 * O modelo SUGERE (`aplicarVeredito`); a decisão final e a revalidação são
 * daqui e do serviço de transições. Uma escolha fora dos candidatos não existe:
 * o parse a recusa antes, e esta função a recusa de novo.
 */
import type { EstadoDaConversa } from "./estado";
import type { Motivo } from "./motivos";
import type { DestinoEfetivo, PoliticaEfetiva } from "./politica/resolver";
import type { RegraDeEntrada } from "./politica/schema";

export interface FatosDaConversa {
  /** force_human, bot_silenced_until=infinity, assignee user ou status claimed. */
  humanoNoComando: boolean;
  bloqueado: boolean;
  /** `conversations.active_ai_agent_id` do roteador antigo (reconciliação). */
  agenteFixadoLegado: string | null;
  /** Execução viva com `silencia_ia` (fluxo de triagem do legado). */
  fluxoVivoLegado: { executionId: string } | null;
  /** `flow_id` da execução que conduz (do coordenador ou do legado), se houver. */
  flowIdConduzindo: string | null;
}

export type CategoriaDaProposta = "regra" | "continuidade" | "modelo" | "manual" | "fallback";

export type Proposta =
  | { acao: "nada"; motivo: Motivo }
  | { acao: "manter"; destino: DestinoEfetivo; categoria: CategoriaDaProposta; motivo: Motivo }
  | { acao: "destino"; destino: DestinoEfetivo; categoria: CategoriaDaProposta; motivo: Motivo }
  | { acao: "adotar_fluxo"; executionId: string; motivo: Motivo }
  | {
      acao: "consultar_modelo";
      candidatos: DestinoEfetivo[];
      atual: DestinoEfetivo | null;
      /** A pessoa devolveu a conversa: a transição que sair daqui é `manual`. */
      retomadaHumana: boolean;
    }
  | { acao: "sem_destino"; motivo: Motivo };

export interface Veredito {
  /** chave de um candidato, "manter" ou "esclarecer"; null = o modelo falhou. */
  escolha: string | null;
  /** null = o provedor não informou; nunca inventado. */
  confianca: number | null;
}

/** Sem acento, sem caixa, espaços colapsados — para regra `contem`/`igual`. */
export function normalizarTexto(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function casaRegra(regra: RegraDeEntrada, texto: string): boolean {
  const t = normalizarTexto(texto);
  return regra.termos.some((termo) => {
    const n = normalizarTexto(termo);
    if (n === "") return false;
    if (regra.quando === "igual") return t === n;
    // `contem` por palavra inteira: "2" não casa "12", "plano" não casa "planos"
    // por acidente de substring.
    const escapado = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escapado}($|[^a-z0-9])`).test(t);
  });
}

/** Mensagem que não carrega intenção sozinha ("sim", "ok", "2", "amanhã"). */
export function ehMensagemCurta(texto: string): boolean {
  const palavras = normalizarTexto(texto).split(" ").filter(Boolean);
  return palavras.length <= 3;
}

export function candidatosElegiveis(politica: PoliticaEfetiva): DestinoEfetivo[] {
  return politica.destinos
    .filter((d) => d.elegivel && d.permite_conduzir)
    .sort((a, b) => b.prioridade - a.prioridade || a.chave.localeCompare(b.chave))
    .slice(0, politica.config.limites.max_candidatos);
}

function destinoPadrao(politica: PoliticaEfetiva): DestinoEfetivo | null {
  const chave = politica.config.destino_padrao;
  if (chave === null) return null;
  const d = politica.destinos.find((x) => x.chave === chave);
  return d && d.elegivel && d.permite_conduzir ? d : null;
}

export function decidir(args: {
  estado: EstadoDaConversa | null;
  politica: PoliticaEfetiva;
  texto: string;
  fatos: FatosDaConversa;
}): Proposta {
  const { estado, politica, texto, fatos } = args;

  // 1. Governança.
  if (fatos.bloqueado) return { acao: "nada", motivo: "contato_bloqueado" };
  if (fatos.humanoNoComando) return { acao: "nada", motivo: "pessoa_assumiu" };

  // Pessoa no estado, mas os fatos dizem que ela devolveu: retomada autorizada.
  const retomadaHumana = estado?.dono_tipo === "pessoa";

  const candidatos = candidatosElegiveis(politica);
  const regra = politica.config.regras_de_entrada.find((r) => casaRegra(r, texto));
  const destinoDaRegra = regra
    ? politica.destinos.find((d) => d.chave === regra.destino && d.elegivel && d.permite_conduzir) ?? null
    : null;

  // 2. Fluxo conduzindo (do coordenador, ou o de triagem do legado ao ligar).
  const fluxoConduzindo =
    estado?.dono_tipo === "fluxo" && estado.dono_execution_id
      ? estado.dono_execution_id
      : estado === null || estado.dono_tipo === "nenhum"
        ? fatos.fluxoVivoLegado?.executionId ?? null
        : null;
  if (fluxoConduzindo !== null) {
    // Interrupção explícita: a regra publicada aponta para OUTRO destino e a
    // política permite interromper.
    // Interrupção explícita: a regra publicada aponta para OUTRO destino que
    // não o fluxo que já conduz, e a política permite interromper. Sem regra
    // inequívoca, a mensagem fica com o fluxo — na dúvida entre continuar e
    // interromper, não se abandona a etapa em silêncio.
    const mesmoFluxo =
      destinoDaRegra?.tipo === "fluxo" && destinoDaRegra.flow_id === fatos.flowIdConduzindo;
    if (destinoDaRegra && !mesmoFluxo && politica.config.interrupcao.permitir) {
      return { acao: "destino", destino: destinoDaRegra, categoria: "regra", motivo: "interrupcao" };
    }
    if (estado?.dono_tipo !== "fluxo") {
      return { acao: "adotar_fluxo", executionId: fluxoConduzindo, motivo: "reconciliacao" };
    }
    return { acao: "nada", motivo: "resposta_a_pergunta" };
  }

  // Quem conduz hoje, se ainda puder conduzir.
  const idAtual =
    estado?.dono_tipo === "agente"
      ? estado.dono_agent_id
      : estado === null || estado.dono_tipo === "nenhum"
        ? fatos.agenteFixadoLegado
        : null;
  const atual =
    idAtual !== null
      ? politica.destinos.find((d) => d.tipo === "agente" && d.agent_id === idAtual && d.elegivel && d.permite_conduzir) ??
        null
      : null;
  const adotado = atual !== null && estado?.dono_tipo !== "agente";

  // 3. Regra explícita.
  if (destinoDaRegra) {
    if (atual && destinoDaRegra.id === atual.id) {
      return { acao: "manter", destino: atual, categoria: "continuidade", motivo: "continua_responsavel" };
    }
    return {
      acao: "destino",
      destino: destinoDaRegra,
      categoria: retomadaHumana ? "manual" : "regra",
      motivo: atual ? "mudanca_de_assunto" : "primeira_mensagem_regra",
    };
  }

  // 4. Continuidade sem ambiguidade.
  if (atual) {
    const semAlternativa = candidatos.filter((c) => c.id !== atual.id).length === 0;
    if (semAlternativa || !politica.config.decisor.usar_modelo || ehMensagemCurta(texto)) {
      return {
        acao: adotado ? "destino" : "manter",
        destino: atual,
        categoria: retomadaHumana ? "manual" : "continuidade",
        motivo: adotado ? "reconciliacao" : "continua_responsavel",
      };
    }
    return { acao: "consultar_modelo", candidatos, atual, retomadaHumana };
  }

  // Primeira escolha.
  if (candidatos.length === 0) {
    const padrao = destinoPadrao(politica);
    return padrao
      ? { acao: "destino", destino: padrao, categoria: "fallback", motivo: "primeira_mensagem_padrao" }
      : { acao: "sem_destino", motivo: "sem_destino_seguro" };
  }
  if (candidatos.length === 1) {
    return {
      acao: "destino",
      destino: candidatos[0]!,
      categoria: retomadaHumana ? "manual" : "regra",
      motivo: "primeira_mensagem_padrao",
    };
  }
  if (politica.config.decisor.usar_modelo) {
    return { acao: "consultar_modelo", candidatos, atual: null, retomadaHumana };
  }
  const padrao = destinoPadrao(politica) ?? candidatos[0]!;
  return { acao: "destino", destino: padrao, categoria: "fallback", motivo: "primeira_mensagem_padrao" };
}

/**
 * Transforma a sugestão do modelo em proposta final.
 *
 * TROCAR de responsável exige confiança informada ≥ mínima. Confiança ausente
 * não autoriza troca — confiança autorrelatada por LLM não é probabilidade
 * calibrada, e inventar um número seria inventar autorização. Na PRIMEIRA
 * escolha alguém precisa conduzir, então a escolha do modelo vale mesmo sem
 * confiança, desde que esteja entre os candidatos.
 */
export function aplicarVeredito(
  consulta: Extract<Proposta, { acao: "consultar_modelo" }>,
  veredito: Veredito,
  politica: PoliticaEfetiva,
): Proposta {
  const { atual, candidatos, retomadaHumana } = consulta;
  const categoriaDeTroca = retomadaHumana ? ("manual" as const) : ("modelo" as const);
  const recuar = (motivo: Motivo): Proposta => {
    if (atual) return { acao: "manter", destino: atual, categoria: "fallback", motivo };
    const padrao = destinoPadrao(politica);
    if (padrao) return { acao: "destino", destino: padrao, categoria: "fallback", motivo };
    const primeiro = candidatos[0];
    return primeiro
      ? { acao: "destino", destino: primeiro, categoria: "fallback", motivo }
      : { acao: "sem_destino", motivo: "sem_destino_seguro" };
  };

  if (veredito.escolha === null) return recuar("decisor_falhou");

  if (veredito.escolha === "manter" || veredito.escolha === "esclarecer") {
    if (atual) return { acao: "manter", destino: atual, categoria: "modelo", motivo: "continua_responsavel" };
    return recuar("primeira_mensagem_padrao");
  }

  const escolhido = candidatos.find((c) => c.chave === veredito.escolha);
  if (!escolhido) return recuar("decisor_falhou");

  if (atual && escolhido.id === atual.id) {
    return { acao: "manter", destino: atual, categoria: "modelo", motivo: "continua_responsavel" };
  }
  if (atual) {
    const minima = politica.config.limites.confianca_minima;
    if (veredito.confianca === null || veredito.confianca < minima) {
      return { acao: "manter", destino: atual, categoria: "fallback", motivo: "continua_responsavel" };
    }
    return { acao: "destino", destino: escolhido, categoria: categoriaDeTroca, motivo: "mudanca_de_assunto" };
  }
  return { acao: "destino", destino: escolhido, categoria: categoriaDeTroca, motivo: "primeira_mensagem_modelo" };
}
