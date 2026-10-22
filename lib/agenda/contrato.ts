/**
 * O CONTRATO DA AGENDA COM PROFISSIONAIS — os tipos que motor, API, agente e
 * tela compartilham (migration 0245).
 *
 * Este arquivo é só tipo. Ele existe ANTES das implementações de propósito:
 * quatro frentes trabalham em paralelo e cada uma honra estas formas, em vez de
 * inventar a sua. Mudar um campo aqui é mudar o contrato das quatro — faça no
 * mesmo commit que ajusta quem o produz e quem o consome.
 *
 * ⚠️ `owner_user_id` continua existindo no banco (= o `user_id` da principal, ou
 * NULL quando ela não tem login). Por isso `ParametrosDaConsulta.ownerUserId` e
 * `MarcarInput.owner_user_id` seguem aceitos como LEGADO: o membro é traduzido
 * para o profissional dele.
 */
import type { Slot } from "./horarios-livres";
import type {
  AutorDoAgendamento,
  OrigemDoAgendamento,
  PapelDoProfissional,
  SituacaoDaConexao,
  TrilhaDaAgenda,
} from "./tipos";

/** Uma pessoa agendável, como as quatro frentes a enxergam. */
export interface ProfissionalResumo {
  id: string;
  nome: string;
  trilha: TrilhaDaAgenda | null;
  /** NULL = profissional sem login. */
  userId: string | null;
  ativo: boolean;
}

/** Quem atende um horário: a principal e, quando o tipo pede duas, a apoio. */
export interface OpcaoDeProfissionais {
  principalId: string;
  apoioId: string | null;
}

/** Um horário livre e as combinações de profissionais que o atendem (>= 1, ordenadas). */
export interface SlotComProfissionais extends Slot {
  opcoes: OpcaoDeProfissionais[];
}

export interface ParametrosDaConsulta {
  /** O tipo, por id OU por slug — exatamente um dos dois. */
  eventTypeId?: string | null;
  eventTypeSlug?: string | null;
  /** Profissionais pedidas explicitamente (até 2). Ausente = as habilitadas no tipo. */
  profissionalIds?: string[] | null;
  /** LEGADO: o membro, traduzido para o profissional dele. */
  ownerUserId?: string | null;
  /** Remarcar não colide com o próprio horário antigo. */
  ignorarAgendamentoId?: string | null;
  de: Date;
  ate: Date;
  /** INJETADO, nunca lido aqui dentro. */
  agora: Date;
}

export type CodigoDeRecusaDaConsulta =
  | "tipo_desconhecido"
  | "tipo_desativado"
  | "sem_responsavel"
  | "jornada_mal_configurada"
  | "profissional_invalido"
  | "profissionais_insuficientes"
  | "erro_interno";

export type ResultadoDaConsulta =
  | {
      ok: true;
      slots: SlotComProfissionais[];
      /** As profissionais consideradas, na ordem de exibição (position, nome). */
      profissionais: ProfissionalResumo[];
      profissionaisNecessarios: 1 | 2;
      fusoDaRegra: string;
      /** DECISÃO 1.1: "não publiquei" e "não tenho vaga" não chegam como a mesma lista vazia. */
      publicouHorarios: boolean;
      /** DECISÃO 20.2: o fuso veio do default, ninguém escolheu. */
      fusoSuposto: boolean;
      fontesDefasadas: SituacaoDaConexao[];
      /** Nenhuma conexão viva jamais sincronizou — a lista de ocupados pode estar vazia por ninguém ter perguntado. */
      agendaExternaNuncaLida: boolean;
      /** Profissionais puladas por jornada quebrada: o resto da agenda segue respondendo. */
      profissionaisComProblema: { id: string; nome: string; motivoParaOperador: string }[];
    }
  | {
      ok: false;
      codigo: CodigoDeRecusaDaConsulta;
      /** Nomeia campo e pessoa. Plateia: quem configura. */
      motivoParaOperador: string;
      /** Sem nome de campo, e diz o que fazer. Plateia: o modelo, e por tabela o cliente. */
      motivoParaCliente: string;
    };

export interface AgendamentoListado {
  id: string;
  titulo: string;
  iniciaEm: string;
  terminaEm: string;
  fuso: string;
  situacao: string;
  donoId: string | null;
  contatoId: string | null;
  contatoNome: string | null;
  profissionais: { id: string; papel: PapelDoProfissional }[];
  eventTypeId: string | null;
  origem: OrigemDoAgendamento;
  autor: AutorDoAgendamento;
  conversaId: string | null;
}

export interface DetalheDoAgendamento {
  id: string;
  titulo: string;
  iniciaEm: string;
  terminaEm: string;
  fuso: string;
  situacao: string;
  origem: OrigemDoAgendamento;
  autor: AutorDoAgendamento;
  notas: string | null;
  motivoDoCancelamento: string | null;
  tipo: { id: string; nome: string } | null;
  contato: { id: string; nome: string | null; telefone: string | null } | null;
  profissionais: (ProfissionalResumo & { papel: PapelDoProfissional })[];
  conversaId: string | null;
  leadId: string | null;
  lembrete: {
    enviadoEm: string | null;
    puladoPor: string | null;
    mensagemAgendadaId: string | null;
  };
}

/** O corpo de "marcar" — a rota, a ferramenta MCP e a tela falam esta forma. */
export interface MarcarInput {
  event_type_id: string;
  starts_at: string;
  /** 1 ou 2 (o que o tipo pede); a primeira é a principal. Ausente = a 1ª opção livre do instante. */
  professional_ids?: string[];
  /** LEGADO: o membro, traduzido para o profissional dele. */
  owner_user_id?: string;
  contact_id?: string;
  conversation_id?: string;
  title?: string;
  notes?: string;
}
