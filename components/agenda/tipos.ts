/**
 * Vocabulário da Agenda — em pt-br, como o resto do produto.
 *
 * O produto renomeia termo técnico na cara do usuário ("Kanban" virou "Funis",
 * "Templates" virou "Respostas rápidas"), então aqui não existe `Booking`,
 * `Event` nem `Slot`: existe agendamento, pessoa e horário.
 *
 * Este arquivo é só forma. Enquanto o schema da Wave 0 não existe, a tela é
 * alimentada por `dados-de-mentira.ts` — e quando existir, o que muda é a
 * origem, não o formato.
 */

/**
 * As visões da grade. A semana é o padrão de quem atende.
 *
 * `profissionais` é o DIA visto por pessoa: uma coluna por profissional, com a
 * apoio desenhada tracejada na coluna dela (`GradePorProfissional`). Responde a
 * pergunta que a semana não responde — "quem está livre agora?" — numa clínica
 * onde duas pessoas atendem em paralelo.
 */
export type VisaoDaAgenda = "dia" | "semana" | "mes" | "profissionais";

/**
 * Índice da trilha de cor, 1..8 — casa com `--agenda-pessoa-N` no globals.css.
 *
 * Vem de `lib/agenda/tipos.ts` e não é redeclarado aqui: o Arquiteto expôs
 * `TRILHAS_DA_AGENDA` depois de adotar o argumento deste módulo (o modelo
 * escolhe QUAL trilha, nunca QUE cor). Manter uma segunda declaração de 1..8
 * seria repetir, no eixo do número, o mesmo defeito que o vocabulário de
 * situação teve — dois símbolos com o mesmo sentido em módulos diferentes.
 */
export type TrilhaDeCor = TrilhaDaAgenda;

export type Pessoa = {
  /** O id do PROFISSIONAL (`calendar_professionals.id`, migration 0245). */
  id: string;
  nome: string;
  /** Atribuída na entrada da pessoa na organização, não sorteada a cada render. */
  trilha: TrilhaDeCor;
  /**
   * O membro por trás da profissional, quando ela tem login. É a ponte para o
   * que ainda chega por `user_id` — a ocupação do Google (dona da conexão) e
   * agendamento legado sem participante —, e é o que `responsavelDaGrade`
   * usa para pôr esses blocos na coluna e na cor certas.
   */
  userId?: string | null;
};

/**
 * O VOCABULÁRIO DE BANCO NÃO MORA AQUI — é importado.
 *
 * Estes dois tipos tinham definição PRÓPRIA neste arquivo, com valores em pt-br
 * (`faltou`, `deskcomm`) enquanto `lib/agenda/tipos.ts` — que espelha o CHECK
 * da migration 0176 — declara `no_show` e `google_sync`. Mesmo NOME de símbolo,
 * conjuntos sem intersecção, em módulos diferentes.
 *
 * O modo de falha era o pior dos três possíveis: **não** dava erro de
 * compilação (são módulos distintos) e **não** dava erro em runtime — daria
 * CARD EM BRANCO no dia em que a frente 1 ligasse a tela ao banco, porque o
 * dado chegaria `no_show` e o `Record` de rótulos não teria a chave. Achado
 * pelo Arquiteto antes de a ligação existir.
 *
 * A regra que fica: o que tem lado no BANCO vem de `lib/agenda/tipos.ts`; o que
 * é só da TELA (visão, trilha de cor, Pessoa) fica aqui, porque não tem lado no
 * banco e não deve ter.
 */
export type { OrigemDoAgendamento, SituacaoDoAgendamento } from "@/lib/agenda/tipos";

import type { OrigemDoAgendamento, SituacaoDoAgendamento, TrilhaDaAgenda } from "@/lib/agenda/tipos";

export type Agendamento = {
  id: string;
  titulo: string;
  /** Quem vai ser atendido. Ausente em ocupação vinda do Google. */
  quemSeraAtendido?: string;
  /** Quem atende (a PRINCIPAL) — é dela a cor do bloco. */
  responsavelId: string;
  /** A segunda profissional, quando o tipo pede duas. Desenhada tracejada na visão por profissional. */
  apoioId?: string;
  contatoId?: string;
  eventTypeId?: string;
  /** A conversa onde o agendamento nasceu — o detalhe linka para ela. */
  conversaId?: string;
  /** ISO-8601. */
  comeca: string;
  termina: string;
  tipo?: string;
  local?: string;
  origem: OrigemDoAgendamento;
  situacao: SituacaoDoAgendamento;
};

/** Um horário oferecido pelo painel de marcação. */
export type HorarioLivre = {
  /** ISO-8601 do início. */
  instante: string;
  /** Rótulo já formatado no fuso de apresentação (ex.: "09:30"). */
  rotulo: string;
  /**
   * QUEM ATENDE este horário, já em texto ("Ana" ou "Ana + Bia"). Ausente na
   * vitrine e em agenda sem profissionais: a linha simplesmente não aparece.
   */
  quem?: string;
  /** A combinação que o horário mostra — é ela que vai no POST, para marcar o que se viu. */
  opcao?: { principalId: string; apoioId: string | null };
  /** Quantas outras combinações também atendem este instante. */
  alternativas?: number;
};
