/**
 * O MOTOR DO LEMBRETE DE AGENDAMENTO — decide, não faz I/O.
 *
 * O cron `agenda-lembretes` chama `rodarLembretes` a cada 10 minutos com as
 * portas de banco reais (`./supabase.ts`); os testes chamam com dublês.
 *
 * ─── O lembrete NÃO cria caminho de envio ────────────────────────────────────
 *
 * Ele só ENFILEIRA uma linha em `conversation_scheduled_messages`, a mesma fila
 * do "Agendar mensagem" da conversa. Quem envia é o cron `scheduled-messages`,
 * que já cuida de janela de horário do número, throttle, contato bloqueado,
 * desfecho do envio e aviso de falha na Central. Um segundo caminho de envio
 * teria de reimplementar tudo isso — e o anti-banimento é exatamente o tipo de
 * regra que diverge na primeira cópia.
 *
 * ─── Por linha, nesta ordem ──────────────────────────────────────────────────
 *
 *   1. `decidirLembrete` (pura): esperar, enviar, pular ou ignorar.
 *   2. Pular: grava o MOTIVO (`reminder_skipped_reason`) e a linha sai da varredura.
 *   3. Enviar: REIVINDICA com UPDATE condicional (`reminder_sent_at is null`) —
 *      dois ticks concorrentes leem a mesma linha, só um a muda. Depois resolve
 *      o canal (contato, conversa, regra de janela do número) e enfileira.
 *      Canal que não serve DEVOLVE a reivindicação gravando o motivo; falha ao
 *      enfileirar devolve SEM motivo, e a próxima rodada tenta de novo.
 *
 * Nada é enfileirado duas vezes: a reivindicação vem antes do insert, e só quem
 * a ganhou enfileira. Lembrete perdido é melhor que lembrete em dobro.
 */
import type { MotivoDeLembretePulado } from "@/lib/agenda/tipos";

import { textoDoLembrete } from "./texto";

/** Um agendamento candidato, como a varredura o entrega. */
export interface AgendamentoParaLembrete {
  id: string;
  organization_id: string;
  starts_at: string;
  created_at: string;
  status: string;
  time_zone: string;
  contact_id: string | null;
  conversation_id: string | null;
  reminder_sent_at: string | null;
  reminder_skipped_reason: string | null;
  tipo: {
    nome: string;
    reminder_enabled: boolean;
    reminder_minutes_before: number;
  } | null;
}

export type DecisaoDoLembrete =
  /** Ainda não é hora. */
  | { tipo: "esperar" }
  /** É hora, e o lembrete cabe: reivindicar e enfileirar. */
  | { tipo: "enviar" }
  /** Não vai ter lembrete, e o motivo fica gravado. */
  | { tipo: "pular"; motivo: MotivoDeLembretePulado }
  /** Não é assunto do lembrete (desligado, já tratado, já passou). */
  | { tipo: "ignorar" };

/**
 * PURA. Quando o lembrete sai:
 *   - o tipo tem lembrete LIGADO (o padrão é desligado — migration 0194);
 *   - o agendamento está `confirmed`, tem contato e ainda não foi tratado;
 *   - `starts_at - minutos <= agora < starts_at`.
 * Marcado DEPOIS do momento do lembrete (ex.: lembrete de 24h, consulta marcada
 * para daqui a 3h) é PULADO, não enviado na hora: a pessoa acabou de combinar,
 * e um "lembrete" minutos depois é ruído — ou pior, parece engano.
 */
export function decidirLembrete(ag: AgendamentoParaLembrete, agora: Date): DecisaoDoLembrete {
  if (ag.reminder_sent_at || ag.reminder_skipped_reason) return { tipo: "ignorar" };
  if (ag.status !== "confirmed" || !ag.contact_id) return { tipo: "ignorar" };
  if (!ag.tipo || !ag.tipo.reminder_enabled) return { tipo: "ignorar" };

  const inicio = new Date(ag.starts_at).getTime();
  const momento = inicio - ag.tipo.reminder_minutes_before * 60_000;
  if (Number.isNaN(inicio) || agora.getTime() >= inicio) return { tipo: "ignorar" };
  if (agora.getTime() < momento) return { tipo: "esperar" };
  if (new Date(ag.created_at).getTime() > momento) {
    return { tipo: "pular", motivo: "marcado_em_cima_da_hora" };
  }
  return { tipo: "enviar" };
}

/** Por onde o lembrete sai: a conversa 1:1 do contato e o número dela. */
export interface CanalDoLembrete {
  conversationId: string;
  channelSessionId: string;
  contactId: string;
  nomeDoCliente: string | null;
}

export type ResolucaoDoCanal =
  | { tipo: "ok"; canal: CanalDoLembrete }
  | { tipo: "pular"; motivo: Exclude<MotivoDeLembretePulado, "marcado_em_cima_da_hora"> };

export interface PortasDoLembrete {
  /** Candidatos: confirmados, com contato, sem lembrete tratado, ainda por vir. */
  candidatos(agora: Date, limite: number): Promise<AgendamentoParaLembrete[]>;
  /** Grava o motivo, condicionado a ninguém ter tratado. `true` = gravou. */
  marcarPulado(ag: AgendamentoParaLembrete, motivo: MotivoDeLembretePulado): Promise<boolean>;
  /** UPDATE condicional `reminder_sent_at is null`. `true` = esta rodada ganhou. */
  reivindicar(ag: AgendamentoParaLembrete, agora: Date): Promise<boolean>;
  canal(ag: AgendamentoParaLembrete, agora: Date): Promise<ResolucaoDoCanal>;
  /** Nomes das profissionais, a principal primeiro. */
  profissionais(ag: AgendamentoParaLembrete): Promise<string[]>;
  /** Insere na fila; devolve o id da mensagem agendada, ou `null` se falhou. */
  enfileirar(ag: AgendamentoParaLembrete, canal: CanalDoLembrete, texto: string, agora: Date): Promise<string | null>;
  /** Grava `reminder_scheduled_message_id`. */
  confirmar(ag: AgendamentoParaLembrete, mensagemAgendadaId: string): Promise<void>;
  /** Desfaz a reivindicação; com motivo, grava o pulo no mesmo UPDATE. */
  devolver(ag: AgendamentoParaLembrete, motivo: MotivoDeLembretePulado | null): Promise<void>;
  /** Aviso na Central, apontando para o agendamento. */
  avisar(ag: AgendamentoParaLembrete, titulo: string, corpo: string): Promise<void>;
}

export interface ResumoDaRodadaDeLembrete {
  enfileirados: number;
  pulados: number;
  falhas: number;
  por_motivo: Partial<Record<MotivoDeLembretePulado, number>>;
}

/** Houve efeito? Rodada vazia não audita (`cron-audita-so-quando-ha-efeito`). */
export function houveEfeito(r: ResumoDaRodadaDeLembrete): boolean {
  return r.enfileirados + r.pulados + r.falhas > 0;
}

/** Quantos candidatos uma rodada olha. A varredura é ordenada pelo início. */
export const LIMITE_POR_RODADA = 300;

const TITULO_CANAL_EXIGE_MODELO = "Lembrete de agendamento não enviado";
const CORPO_CANAL_EXIGE_MODELO =
  "O número desta conversa só aceita mensagem livre enquanto a cliente escreveu nas últimas 24 horas, " +
  "e o lembrete automático é mensagem livre. Lembre a cliente por outro meio, ou pela conversa quando ela escrever.";

export async function rodarLembretes(
  portas: PortasDoLembrete,
  agora: Date,
  limite: number = LIMITE_POR_RODADA,
): Promise<ResumoDaRodadaDeLembrete> {
  const resumo: ResumoDaRodadaDeLembrete = { enfileirados: 0, pulados: 0, falhas: 0, por_motivo: {} };
  const contarPulo = (motivo: MotivoDeLembretePulado) => {
    resumo.pulados += 1;
    resumo.por_motivo[motivo] = (resumo.por_motivo[motivo] ?? 0) + 1;
  };

  const candidatos = await portas.candidatos(agora, limite);
  for (const ag of candidatos) {
    const decisao = decidirLembrete(ag, agora);
    if (decisao.tipo === "esperar" || decisao.tipo === "ignorar") continue;

    if (decisao.tipo === "pular") {
      if (await portas.marcarPulado(ag, decisao.motivo)) contarPulo(decisao.motivo);
      continue;
    }

    if (!(await portas.reivindicar(ag, agora))) continue; // outra rodada levou.

    // Depois que a fila aceitou a mensagem, NADA devolve a reivindicação:
    // devolver faria a próxima rodada enfileirar de novo — lembrete em dobro.
    let enfileirado = false;
    try {
      const canal = await portas.canal(ag, agora);
      if (canal.tipo === "pular") {
        await portas.devolver(ag, canal.motivo);
        contarPulo(canal.motivo);
        if (canal.motivo === "canal_exige_template") {
          await portas.avisar(ag, TITULO_CANAL_EXIGE_MODELO, CORPO_CANAL_EXIGE_MODELO);
        }
        continue;
      }

      const texto = textoDoLembrete({
        nomeDoCliente: canal.canal.nomeDoCliente,
        servico: ag.tipo?.nome ?? "",
        iniciaEm: new Date(ag.starts_at),
        fuso: ag.time_zone,
        profissionais: await portas.profissionais(ag),
        agora,
      });
      const id = await portas.enfileirar(ag, canal.canal, texto, agora);
      if (!id) {
        await portas.devolver(ag, null);
        resumo.falhas += 1;
        continue;
      }
      enfileirado = true;
      resumo.enfileirados += 1;
      await portas.confirmar(ag, id);
    } catch {
      if (enfileirado) continue; // saiu para a fila; só o ponteiro ficou sem gravar.
      // Infra no meio do caminho: devolve para a próxima rodada tentar. Se nem
      // devolver der, a linha fica reivindicada e sem lembrete — o lado seguro
      // (nunca em dobro).
      await portas.devolver(ag, null).catch(() => undefined);
      resumo.falhas += 1;
    }
  }
  return resumo;
}
