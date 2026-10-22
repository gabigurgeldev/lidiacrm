/**
 * O que ocupa um horário — e o que só parece ocupar.
 *
 * O motor (`horariosLivres`) recebe uma lista de `Ocupado` e não pergunta de
 * onde veio. Quem decide o que entra nela é este arquivo, e cada regra daqui
 * tem um desfecho concreto do lado de fora: oferecer um horário que não existe,
 * ou esconder um que existe.
 *
 * ─── A assimetria que governa todas as decisões deste arquivo ─────────────
 *
 * **Oferecer de menos é recuperável; marcar em cima não é.** Um horário
 * escondido volta assim que alguém remarca ou reconecta. Um paciente chegando
 * para uma consulta que não existe custa a confiança, e não tem desfazer.
 *
 * Por isso, na dúvida, OCUPA. Vale para status que ainda não existe no
 * vocabulário, para evento tentativo, e para a conexão do Google que caiu.
 */
import {
  CONEXAO_CONTA_COMO_OCUPACAO,
  SITUACOES_DO_AGENDAMENTO,
  type SituacaoDaConexao,
  type SituacaoExterna,
} from "./tipos";

import type { Ocupado } from "./horarios-livres";

/**
 * A linha de `calendar_appointments` como o banco a devolve — ou a participação
 * (`calendar_appointment_professionals`), que espelha as mesmas três colunas.
 *
 * `id` é o id do AGENDAMENTO (na participação, `appointment_id`). Opcional só
 * porque `ocupadosDoDono` não precisa dele; `ocupadosDoProfissional` precisa,
 * para não contar duas vezes o mesmo agendamento que chega pelas duas portas.
 */
export interface LinhaDeAgendamento {
  id?: string;
  starts_at: string;
  ends_at: string;
  status: string;
}

/**
 * A linha de `calendar_external_events`, já com a situação da conexão junto.
 *
 * ⚠️ `calendar_external_events` NÃO TEM `user_id`: o dono vem por
 * `connection_id → calendar_connections.user_id`, então a query precisa do
 * join — e é lá que a situação da conexão é colhida de carona.
 */
export interface LinhaDeEventoExterno {
  starts_at: string;
  ends_at: string;
  transparency: string;
  status: string;
  situacaoDaConexao: string;
}

export interface OQueOcupa {
  ocupados: Ocupado[];
  /**
   * As situações de conexão que produziram algum conflito e NÃO estão
   * saudáveis — para a tela dizer "sua agenda do Google desconectou; estes
   * horários podem estar defasados" em vez de mentir nos dois sentidos.
   *
   * Falha fechada na AÇÃO (o horário fica bloqueado), aberta na INFORMAÇÃO.
   */
  fontesDefasadas: SituacaoDaConexao[];
}

/**
 * Situações do agendamento que LIBERAM o horário. Todo o resto ocupa —
 * inclusive um valor que ainda não exista neste vocabulário.
 *
 * `pending` NÃO está aqui de propósito: "aguardando confirmação" é um pedido em
 * cima daquele horário, e não contá-lo faria um segundo pedido ser aceito para
 * o mesmo instante, com um dos dois levando bolo.
 */
const LIBERAM_O_HORARIO = new Set<string>(["cancelled", "no_show"]);

/**
 * O que cada situação de evento externo faz com o horário.
 *
 * ⚠️ `Record` EXAUSTIVO, e não um `Set` de literais, pela mesma razão que
 * `SITUACOES_QUE_OCUPAM` deixou de ser lista solta: um `Set` parece guarda e não
 * guarda nada — situação nova cairia no padrão sem ninguém decidir. Aqui o
 * compilador cobra a decisão, porque `SituacaoExterna` é união fechada.
 *
 * `tentative` ocupa: "talvez eu vá" é a pessoa segurando aquele horário, e o
 * desfecho seguro é não oferecê-lo. `cancelled` libera — o horário voltou a
 * existir de verdade.
 */
const OCUPA_NO_GOOGLE: Record<SituacaoExterna, boolean> = {
  confirmed: true,
  tentative: true,
  cancelled: false,
};

function intervaloValido(inicioISO: string, fimISO: string): Ocupado | null {
  const inicio = new Date(inicioISO);
  const fim = new Date(fimISO);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return null;
  if (fim.getTime() <= inicio.getTime()) return null;
  return { inicio, fim };
}

export function ocupadosDoDono(
  agendamentos: LinhaDeAgendamento[],
  externos: LinhaDeEventoExterno[],
): OQueOcupa {
  const ocupados: Ocupado[] = [];
  const defasadas = new Set<SituacaoDaConexao>();

  for (const linha of agendamentos) {
    if (LIBERAM_O_HORARIO.has(linha.status)) continue;
    const intervalo = intervaloValido(linha.starts_at, linha.ends_at);
    if (intervalo) ocupados.push(intervalo);
  }

  for (const linha of externos) {
    if (linha.transparency === "transparent") continue;
    // Situação fora do vocabulário ocupa — o mesmo desfecho seguro do lado do
    // CRM: o que não se conhece bloqueia, nunca libera.
    if (OCUPA_NO_GOOGLE[linha.status as SituacaoExterna] === false) continue;
    const intervalo = intervaloValido(linha.starts_at, linha.ends_at);
    if (!intervalo) continue;

    // ⚠️ A CONEXÃO CAÍDA CONTINUA OCUPANDO (DECISÃO 3.2, versão corrigida).
    //
    // A primeira versão da decisão mandava parar de contar o calendário
    // expirado, justificando que contar "uma fonte que não responde marcaria em
    // cima de compromisso real". O argumento estava invertido, e o maestro o
    // corrigiu: PARAR de contar é que causa o marcar em cima. O compromisso
    // segue existindo na agenda do Google da pessoa; o que parou foi a
    // ATUALIZAÇÃO dele, não a existência.
    //
    // O que temos é o último estado conhecido. Contá-lo pode bloquear um
    // horário que já vagou — e aí alguém liga e remarca. Não contá-lo oferece
    // um horário ocupado — e aí o paciente chega e o médico não está.
    // OCUPAR e AVISAR são perguntas diferentes, e até aqui compartilhavam um `if`.
    // `CONEXAO_CONTA_COMO_OCUPACAO` responde a primeira — bloqueia a menos que um
    // humano tenha mandado parar —, e o aviso continua respondendo a segunda: tudo
    // que não é `healthy` é fonte defasada, inclusive o que ocupa.
    //
    // Hoje isto não muda desfecho: a rota de desconectar APAGA os eventos externos,
    // então não há linha com conexão `disconnected` para filtrar. É defesa em
    // profundidade — cobre quem marcar `disconnected` por SQL de suporte ou por uma
    // segunda rota amanhã. E o mapa era ÓRFÃO: prometia decidir ocupação e ninguém o
    // importava, que é o defeito descrito vinte linhas abaixo sobre outra constante.
    const situacao = linha.situacaoDaConexao as SituacaoDaConexao;
    if (CONEXAO_CONTA_COMO_OCUPACAO[situacao] ?? true) ocupados.push(intervalo);
    if (situacao !== "healthy") {
      defasadas.add(situacao);
    }
  }

  return { ocupados, fontesDefasadas: [...defasadas] };
}

export interface FontesDoProfissional {
  /** Onde ela atende — principal OU apoio (`calendar_appointment_professionals`). */
  participacoes: LinhaDeAgendamento[];
  /**
   * Agendamentos em que o `user_id` dela é `owner_user_id` — vazio para quem não
   * tem login. É a porta LEGADA: linha que nasceu antes da 0245 sem participante
   * (o backfill pula duplicata legada) ou que o sync do Google trouxe pelo dono.
   */
  agendamentosDoDono: LinhaDeAgendamento[];
  externos: LinhaDeEventoExterno[];
}

/**
 * O que ocupa UMA profissional — a união das duas portas, sem contar duas vezes.
 *
 * ⚠️ AS DUAS PORTAS SE SOBREPÕEM DE PROPÓSITO. Todo agendamento de quem tem
 * login aparece como participação E como `owner_user_id`; ler só a participação
 * esqueceria a linha legada sem participante, e ler só o dono esqueceria a apoio
 * (que nunca é dona). A união cobre as duas; o dedupe por id do agendamento é o
 * que impede o mesmo compromisso de virar dois ocupados — inofensivo para o
 * motor, mas cada duplicata é uma linha a mais que a próxima regra precisaria
 * saber ignorar.
 *
 * `ignorarAgendamentoId` é o REMARCAR: o horário antigo do próprio agendamento
 * não pode ocupar o novo, senão remarcar 30 minutos para frente colide consigo
 * mesmo (o handler só tratava o mesmo instante exato).
 */
export function ocupadosDoProfissional(
  fontes: FontesDoProfissional,
  ignorarAgendamentoId?: string | null,
): OQueOcupa {
  const porId = new Map<string, LinhaDeAgendamento>();
  const semId: LinhaDeAgendamento[] = [];
  for (const linha of [...fontes.participacoes, ...fontes.agendamentosDoDono]) {
    if (linha.id === undefined) {
      semId.push(linha);
      continue;
    }
    if (ignorarAgendamentoId && linha.id === ignorarAgendamentoId) continue;
    // A primeira vence: a participação vem antes e carrega o espelho do status,
    // que é o mesmo do agendamento (o trigger da 0245 o mantém).
    if (!porId.has(linha.id)) porId.set(linha.id, linha);
  }
  return ocupadosDoDono([...porId.values(), ...semId], fontes.externos);
}

/**
 * As situações que OCUPAM, derivadas — e ela existe para ser VERIFICADA, não
 * para ser lida.
 *
 * ⚠️ A versão anterior deste bloco dizia "é a lista ao alcance de quem edita,
 * para a decisão não ser tomada por omissão" — e não era: ninguém a importava,
 * nenhum teste a lia, e o comentário prometia uma guarda que não existia. Órfão
 * com promessa é pior que órfão calado, porque quem lê acha que está protegido.
 *
 * O consumidor agora é `tests/unit/agenda-o-que-ocupa.test.ts`, que prova que
 * toda situação do vocabulário está classificada — ou libera, ou ocupa, nunca
 * fora das duas. Se `SITUACOES_DO_AGENDAMENTO` ganhar um valor e ninguém decidir
 * aqui, o teste diz qual.
 *
 * (Achado aplicando em mim a régua do Arquiteto: export sem consumidor NOMEADO
 * é dívida sem dono. Ele varreu `lib/agenda` e achou 28; cinco eram meus, e
 * quatro daqueles são tipos de assinatura — este era o único morto de verdade.)
 */
export const SITUACOES_QUE_OCUPAM = SITUACOES_DO_AGENDAMENTO.filter(
  (s) => !LIBERAM_O_HORARIO.has(s),
);

/** O par: as que liberam. Exportada para o mesmo teste poder somar as duas. */
export const SITUACOES_QUE_LIBERAM = SITUACOES_DO_AGENDAMENTO.filter((s) =>
  LIBERAM_O_HORARIO.has(s),
);

/** Uma linha de `calendar_connections`, no que interessa para saber se dá para confiar. */
export interface LinhaDeConexao {
  status: string;
  last_sync_at: string | null;
}

/**
 * A agenda externa deste dono é confiável AGORA?
 *
 * ⚠️ "NÃO TEM GOOGLE" E "TEM GOOGLE QUE NUNCA FOI LIDO" PRODUZEM A MESMA LISTA
 * VAZIA DE OCUPADOS — e são coisas opostas.
 *
 * Sem conexão nenhuma, não há nada lá fora e oferecer o dia inteiro está certo.
 * Com conexão que nunca sincronizou (`last_sync_at is null`), há compromissos no
 * Google que ninguém trouxe para cá — e o motor oferece a hora da cirurgia que
 * está na agenda do médico. O paciente chega e o médico está no centro
 * cirúrgico.
 *
 * É o mesmo formato de `publicouHorarios` e de `fusoSuposto`: um sinal que
 * preserva a distinção que o dado normalizado apaga. Sem ele, quem lê a lista
 * vazia conclui "está livre", e a conclusão errada não gera chamado nenhum.
 *
 * ⚠️ NÃO CONFUNDIR COM `fontesDefasadas`, que é outra pergunta: lá a conexão
 * JÁ trouxe eventos e parou de atualizar (e eles continuam ocupando, DECISÃO
 * 3.2). Aqui ela nunca trouxe nada.
 */
export function agendaExternaNuncaLida(conexoes: LinhaDeConexao[]): boolean {
  const vivas = conexoes.filter((c) => c.status !== "disconnected");
  if (vivas.length === 0) return false;
  return vivas.every((c) => c.last_sync_at === null);
}
