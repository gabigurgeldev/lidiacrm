/**
 * O MOTOR DA MENSAGEM AGENDADA — decide, não faz I/O.
 *
 * O atendente marcou pela conversa (Lembrar → "Agendar mensagem…"): texto,
 * número de saída e horário, e opcionalmente um aviso para ele mesmo. O cron
 * `scheduled-messages` chama `rodarAgendamentos` a cada minuto com as portas
 * de banco reais (`./supabase.ts`); os testes chamam com dublês.
 *
 * Para cada linha vencida, nesta ordem:
 *   1. JANELA do número (7h–22h por padrão, knob por canal): fechada, a linha
 *      volta a `scheduled` com o horário da abertura. Mandar às 23h o que foi
 *      marcado para as 23h é exatamente o que a janela existe para impedir.
 *   2. CONTATO: bloqueado, anonimizado, mesclado ou sem telefone → `failed`
 *      + Aviso. Consentimento de marketing NÃO barra: isto é o atendente
 *      falando 1:1 com o cliente dele, a mesma coisa que digitar na conversa —
 *      e o envio digitado também não pede consentimento de marketing.
 *   3. ENVIO ao cliente: o desfecho vem do ESTADO da mensagem, nunca da
 *      ausência de exceção (ver `lib/automation/desfecho-do-envio.ts`).
 *   4. AVISO ao atendente, se pedido. Sai mesmo quando o envio ao cliente
 *      falhou — o atendente pediu para ser lembrado naquela hora, e o aviso na
 *      Central conta o que deu errado. Falhar aqui não desfaz o envio.
 *
 * Nada é reenviado: `sending` preso (processo morto no meio) vira `failed`
 * com aviso, nunca volta a `scheduled`. Envio em dobro é pior que não-envio.
 */
import { checarContato, type ContatoDoContexto } from "@/lib/automation/guarda-do-contato";

export interface Agendamento {
  id: string;
  organization_id: string;
  conversation_id: string;
  contact_id: string;
  channel_session_id: string;
  body: string;
  scheduled_for: string;
  notify_phone: string | null;
  notify_body: string | null;
  created_by_user_id: string | null;
}

export type DesfechoDoEnvio =
  | { kind: "enviado"; messageId: string }
  | { kind: "na_fila"; messageId: string; motivo: string }
  | { kind: "recusado"; motivo: string; messageId?: string };

export interface Conclusao {
  status: "sent" | "queued" | "failed";
  message_id: string | null;
  notify_message_id: string | null;
  failure_reason: string | null;
}

export interface PortasDoMotor {
  /** `sending` com trava vencida: o processo morreu no meio. */
  resgatarPresas(agora: Date): Promise<Agendamento[]>;
  /** Vencidas, já travadas em `sending` por quem chamou. */
  reivindicarVencidas(agora: Date, limite: number): Promise<Agendamento[]>;
  /** Assinatura em dia? Org sem acesso não envia, como o disparo em massa. */
  podeOperar(organizationId: string): Promise<boolean>;
  /** `null` = janela aberta; senão, ISO da abertura. */
  janelaAbreEm(a: Agendamento, agora: Date): Promise<string | null>;
  contato(a: Agendamento): Promise<ContatoDoContexto | null>;
  enviarAoCliente(a: Agendamento): Promise<DesfechoDoEnvio>;
  enviarAviso(a: Agendamento): Promise<DesfechoDoEnvio>;
  remarcar(a: Agendamento, paraIso: string): Promise<void>;
  concluir(a: Agendamento, c: Conclusao): Promise<void>;
  abrirAviso(a: Agendamento, titulo: string, corpo: string): Promise<void>;
}

export interface ResumoDaRodada {
  enviados: number;
  na_fila: number;
  remarcados: number;
  falhos: number;
}

/** Houve efeito? Rodada vazia não audita (ver `cron-audita-so-quando-ha-efeito`). */
export function houveEfeito(r: ResumoDaRodada): boolean {
  return r.enviados + r.na_fila + r.remarcados + r.falhos > 0;
}

const FRASE_DO_BLOQUEIO: Record<string, string> = {
  no_contact: "o contato não existe mais",
  contact_blocked: "o cliente bloqueou o atendimento",
  contact_anonymized: "o contato foi anonimizado (LGPD)",
  contact_merged: "o contato foi mesclado com outro",
  no_phone: "o contato não tem telefone",
};

function trecho(texto: string): string {
  return texto.length > 80 ? `${texto.slice(0, 77)}…` : texto;
}

export async function rodarAgendamentos(
  portas: PortasDoMotor,
  agora: Date,
  limite = 50,
): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = { enviados: 0, na_fila: 0, remarcados: 0, falhos: 0 };

  for (const presa of await portas.resgatarPresas(agora)) {
    await portas.concluir(presa, {
      status: "failed",
      message_id: null,
      notify_message_id: null,
      failure_reason: "envio_interrompido",
    });
    await portas.abrirAviso(
      presa,
      "Mensagem agendada pode não ter saído",
      `O envio de "${trecho(presa.body)}" foi interrompido no meio. Confira a conversa antes de mandar de novo — ela pode ter chegado.`,
    );
    resumo.falhos++;
  }

  for (const a of await portas.reivindicarVencidas(agora, limite)) {
    if (!(await portas.podeOperar(a.organization_id))) {
      await portas.concluir(a, {
        status: "failed",
        message_id: null,
        notify_message_id: null,
        failure_reason: "assinatura_inativa",
      });
      await portas.abrirAviso(
        a,
        "Mensagem agendada não saiu",
        `"${trecho(a.body)}" não foi enviada: a assinatura da conta não está ativa.`,
      );
      resumo.falhos++;
      continue;
    }

    const abre = await portas.janelaAbreEm(a, agora);
    if (abre !== null) {
      await portas.remarcar(a, abre);
      resumo.remarcados++;
      continue;
    }

    const contato = await portas.contato(a);
    // Consentimento fora da régua de propósito — ver o cabeçalho, passo 2.
    const guarda = checarContato(contato ? { ...contato, consent: null } : null);

    let cliente: DesfechoDoEnvio;
    if (!guarda.ok) {
      cliente = { kind: "recusado", motivo: guarda.reason };
    } else {
      cliente = await portas.enviarAoCliente(a);
    }

    let aviso: DesfechoDoEnvio | null = null;
    if (a.notify_phone && a.notify_body) aviso = await portas.enviarAviso(a);

    const conclusao: Conclusao = {
      status:
        cliente.kind === "enviado" ? "sent" : cliente.kind === "na_fila" ? "queued" : "failed",
      message_id: cliente.kind === "recusado" ? (cliente.messageId ?? null) : cliente.messageId,
      notify_message_id: aviso && aviso.kind !== "recusado" ? aviso.messageId : null,
      failure_reason: cliente.kind === "recusado" ? cliente.motivo : null,
    };
    await portas.concluir(a, conclusao);

    if (cliente.kind === "recusado") {
      const porque = FRASE_DO_BLOQUEIO[cliente.motivo] ?? cliente.motivo;
      await portas.abrirAviso(
        a,
        "Mensagem agendada não saiu",
        `"${trecho(a.body)}" não foi enviada: ${porque}.`,
      );
      resumo.falhos++;
    } else if (cliente.kind === "na_fila") {
      resumo.na_fila++;
    } else {
      resumo.enviados++;
    }

    if (aviso?.kind === "recusado") {
      await portas.abrirAviso(
        a,
        "Aviso da mensagem agendada não saiu",
        `O aviso para ${a.notify_phone} não foi enviado: ${aviso.motivo}.`,
      );
    }
  }

  return resumo;
}
