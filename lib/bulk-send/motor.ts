/**
 * O MOTOR DO DISPARO EM MASSA — regra pura, dependências injetadas.
 *
 * Molde de `lib/followup/engine.ts`: nada de I/O direto aqui, tudo entra por
 * `DisparoDeps`. É o que permite exercitar janela fechada, cap de warm-up,
 * orçamento estourado e canal caído com relógio falso e sem Postgres.
 *
 * ═══ O tique, em quatro passos ═══
 *
 *   1. Promove `scheduled` cuja hora chegou para `running`.
 *   2. Reclama até N disparos vencidos, com lease (`fn_claim_due_bulk_sends`).
 *   3. Para cada um: varre `sending` órfão → pré-voo do canal → laço de envio
 *      governado por `decidePacing` + `intervaloEfetivo`, dentro de um orçamento
 *      de tempo.
 *   4. Fila vazia fecha o disparo.
 *
 * ═══ Por que um ORÇAMENTO de tempo, e não um teto de mensagens ═══
 *
 * Porque o que precisa caber é o TIQUE, não a campanha. Um teto de mensagens
 * ("20 por tique") acelera ou trava conforme o intervalo escolhido: com 1 msg/5s
 * ele estoura o timeout do cron; com 1 msg/60s ele deixa a campanha ociosa. O
 * orçamento de tempo é indiferente ao intervalo — o que sobra vai para
 * `next_send_at` e o tique seguinte continua. E, principalmente: aumentar o
 * orçamento NÃO acelera o disparo, porque quem espaça é o pacing. Um teto de
 * mensagens seria um acelerador disfarçado de knob de performance.
 *
 * ═══ O desfecho vem do ESTADO DA MENSAGEM, nunca da ausência de exceção ═══
 *
 * `sendMessageHandler` NÃO lança quando o envio falha: ele marca a linha de
 * `messages` (`failed`, com `error_code`) ou a deixa em `queued`, e devolve a
 * mensagem normalmente — porque quem o chama pela tela é o Inbox, que renderiza
 * a bolha com o estado dela. Ler "não lançou" como "enviado" foi o defeito
 * MEDIDO que `lib/automation/desfecho-do-envio.ts` existe para matar, e num
 * disparo ele seria pior: a tela diria "500 enviados" com o transporte fora do
 * ar e ninguém tendo recebido nada. Usamos aquele tradutor, não um novo.
 *
 * ═══ O que este motor NÃO faz, e é dívida declarada ═══
 *
 * Não varia a copy. O `spinningGate` (`lib/agent-engine/guardrails/before-send.ts`)
 * existe exatamente contra "template idêntico em massa na janela do número", e
 * NÃO roda neste caminho — ele é do agent-engine, que fala `pg.Pool`. Aqui a
 * mesma mensagem sai para todo mundo *de propósito*, porque é o que uma campanha
 * é, e o mitigador é o ritmo (intervalo + jitter + warm-up + cap). Quem for
 * fazer spinning de copy no disparo: é frente própria, e ninguém deve ler este
 * arquivo e presumir que já está coberta.
 */
import { decidePacing, type PacingState } from "@/lib/agent-engine/pacing/engine";
import type { PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import { capabilitiesOf, type ChannelProvider } from "@/lib/channels/capabilities";
import { desfechoDoEnvio, type MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import { checarContato, type ContatoDoContexto } from "@/lib/automation/guarda-do-contato";
import { intervaloEfetivo } from "@/lib/bulk-send/ritmo";

/** Orçamento do tique. O crontab dá 45s de timeout; sobra folga para o resto. */
export const ORCAMENTO_DO_TIQUE_MS = 40_000;

/** Quantos disparos um tique reclama. Lease em segundos. */
export const DISPAROS_POR_TIQUE = 5;
export const LEASE_SEGUNDOS = 60;

/**
 * Falhas de canal seguidas que pausam a campanha. Um número recém-banido erra
 * em TODO envio; continuar martelando confirma o padrão para a plataforma e
 * gasta a lista inteira contra um chip morto.
 */
export const FALHAS_SEGUIDAS_PARA_PAUSAR = 5;

/**
 * Quanto o disparo espera quando o número está desconectado. Cinco minutos: o
 * suficiente para não martelar a cada minuto, curto o bastante para retomar
 * logo depois de alguém reconectar. Reconexão é evento humano, não de rede.
 */
export const ESPERA_DE_CANAL_CAIDO_MS = 5 * 60_000;

/**
 * Quanto o disparo espera quando a fila de `pending` acabou mas ainda há gente
 * em voo. Curto: só falta o canal confirmar, e a campanha fecha logo depois.
 */
export const ESPERA_DE_EM_VOO_MS = 60_000;

/**
 * Quantas vezes se readmite um destinatário cuja mensagem continua `queued`
 * antes de chamá-la de falha. Sem teto ele ficaria em voo para sempre: o
 * `recover-stuck-messages` não toca em `queued` de propósito, então ninguém
 * mais o resolveria, e o disparo nunca terminaria.
 */
export const TENTATIVAS_ANTES_DE_DESISTIR = 3;

// ---------------------------------------------------------------------------
// O contrato com o mundo
// ---------------------------------------------------------------------------

export interface DisparoEmVoo {
  id: string;
  organization_id: string;
  channel_session_id: string;
  provider: string;
  mode: "freeform" | "template";
  body: string | null;
  template_name: string | null;
  template_language: string | null;
  template_values: Record<string, string>;
  interval_ms: number;
}

export interface SessaoDoCanal {
  id: string;
  provider: string;
  status: string;
  archived_at: string | null;
  daily_message_limit: number | null;
}

export interface DestinatarioPendente {
  id: string;
  contact_id: string;
  contato: ContatoDoContexto | null;
}

export interface EmVooOrfao {
  id: string;
  message_id: string | null;
  /** Quantas vezes já foi readmitido em voo — o teto é TENTATIVAS_ANTES_DE_DESISTIR. */
  attempts?: number;
}

export interface PatchDoDestinatario {
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  skip_reason?: string | null;
  error?: string | null;
  message_id?: string | null;
  sent_at?: string | null;
  incrementarTentativa?: boolean;
}

export interface PatchDoDisparo {
  status?: "running" | "paused" | "done";
  next_send_at?: string | null;
  claimed_until?: string | null;
  pause_reason?: string | null;
  pause_detail?: string | null;
  finished_at?: string | null;
}

export interface DisparoDb {
  /** `scheduled` cuja hora chegou vira `running`. Devolve quantos promoveu. */
  promoverAgendados(agora: Date): Promise<number>;
  /** `fn_claim_due_bulk_sends`. */
  reclamarDisparos(limite: number, leaseSegundos: number): Promise<DisparoEmVoo[]>;
  sessaoDoCanal(organizationId: string, channelSessionId: string): Promise<SessaoDoCanal | null>;
  configDePacing(
    organizationId: string,
    channelSessionId: string,
  ): Promise<{ knobs: PacingKnobs; numberActivatedAt: Date | null }>;
  estadoDePacing(
    organizationId: string,
    channelSessionId: string,
    entrada: { agora: Date; timezone: string; numberActivatedAt: Date | null },
  ): Promise<PacingState>;
  /** Destinatários que ficaram em `sending` de um tique que morreu. */
  emVooOrfaos(bulkSendId: string, organizationId: string): Promise<EmVooOrfao[]>;
  lerMensagem(organizationId: string, messageId: string): Promise<MensagemEnviada | null>;
  proximoPendente(bulkSendId: string, organizationId: string): Promise<DestinatarioPendente | null>;
  marcarDestinatario(
    id: string,
    organizationId: string,
    patch: PatchDoDestinatario,
  ): Promise<void>;
  atualizarDisparo(id: string, organizationId: string, patch: PatchDoDisparo): Promise<void>;
  registrarEnvioNoLedger(
    organizationId: string,
    channelSessionId: string,
    sentAt: Date,
  ): Promise<void>;
  /** O laço de retorno: campanha travada aparece na Central de avisos. */
  avisarNaCentral(entrada: {
    organizationId: string;
    bulkSendId: string;
    titulo: string;
    corpo: string;
    severidade: "info" | "warn" | "critical";
  }): Promise<void>;
}

export interface DisparoDeps {
  db: DisparoDb;
  relogio: () => Date;
  dormir: (ms: number) => Promise<void>;
  /** Manda UMA mensagem e devolve a LINHA de `messages` — nunca um booleano. */
  enviar: (
    disparo: DisparoEmVoo,
    destinatario: DestinatarioPendente,
  ) => Promise<MensagemEnviada>;
  rng?: () => number;
  orcamentoMs?: number;
}

export interface ResumoDoTique {
  promovidos: number;
  reclamados: number;
  enviados: number;
  falhados: number;
  pulados: number;
  concluidos: number;
  adiados: number;
  /**
   * O claim não chegou ao banco. Existe porque, sem ele, um tique que falhou é
   * IDÊNTICO na trilha a um tique de instalação parada: todos os contadores
   * zero. Foi o buraco documentado no `followup-flow-worker` — o campo era
   * emitido e ninguém o lia (anti-pattern 3: evento sem consumer).
   */
  claim_falhou?: boolean;
}

const RESUMO_ZERO: ResumoDoTique = {
  promovidos: 0,
  reclamados: 0,
  enviados: 0,
  falhados: 0,
  pulados: 0,
  concluidos: 0,
  adiados: 0,
};

/** O tique mexeu em alguma coisa? É o que decide se a rodada AUDITA. */
export function houveEfeito(r: ResumoDoTique): boolean {
  return Boolean(
    r.claim_falhou ||
      r.promovidos ||
      r.reclamados ||
      r.enviados ||
      r.falhados ||
      r.pulados ||
      r.concluidos ||
      r.adiados,
  );
}

// ---------------------------------------------------------------------------
// O tique
// ---------------------------------------------------------------------------

export async function rodarTiqueDeDisparo(deps: DisparoDeps): Promise<ResumoDoTique> {
  const resumo: ResumoDoTique = { ...RESUMO_ZERO };
  const orcamentoMs = deps.orcamentoMs ?? ORCAMENTO_DO_TIQUE_MS;
  const limite = deps.relogio().getTime() + orcamentoMs;

  resumo.promovidos = await deps.db.promoverAgendados(deps.relogio());

  let disparos: DisparoEmVoo[];
  try {
    disparos = await deps.db.reclamarDisparos(DISPAROS_POR_TIQUE, LEASE_SEGUNDOS);
  } catch {
    resumo.claim_falhou = true;
    return resumo;
  }
  resumo.reclamados = disparos.length;

  for (const disparo of disparos) {
    // Um disparo que estoura não pode levar os outros do lote junto.
    try {
      await tocarUmDisparo(deps, disparo, limite, resumo);
    } catch (err) {
      await deps.db.atualizarDisparo(disparo.id, disparo.organization_id, {
        status: "paused",
        pause_reason: "operador",
        pause_detail:
          "O disparo parou por um erro inesperado: " +
          (err instanceof Error ? err.message : String(err)),
        next_send_at: null,
        claimed_until: null,
      });
      resumo.adiados += 1;
    }
    if (deps.relogio().getTime() >= limite) break;
  }

  return resumo;
}

async function tocarUmDisparo(
  deps: DisparoDeps,
  disparo: DisparoEmVoo,
  limite: number,
  resumo: ResumoDoTique,
): Promise<void> {
  const { db } = deps;
  const org = disparo.organization_id;

  // ─── 1. Os que ficaram em voo quando o tique anterior morreu ───────────────
  //
  // Sem `message_id` nada chegou a ser criado: volta para a fila com segurança.
  // COM `message_id`, a mensagem EXISTE — reenviar seria mandar em dobro, que é
  // pior que não mandar. Lê-se o estado dela e adota-se o desfecho.
  for (const orfao of await db.emVooOrfaos(disparo.id, org)) {
    if (!orfao.message_id) {
      await db.marcarDestinatario(orfao.id, org, { status: "pending" });
      continue;
    }
    const mensagem = await db.lerMensagem(org, orfao.message_id);
    if (!mensagem) {
      await db.marcarDestinatario(orfao.id, org, { status: "pending" });
      continue;
    }
    const desfecho = await adotarDesfecho(deps, disparo, orfao.id, mensagem, resumo);

    // A mensagem continua `queued`: o canal ainda não a aceitou. Ela pode sair
    // — o watchdog do agent-engine resgata `queued` quando a sessão volta — mas
    // não pode ficar pendurada para sempre.
    //
    // Sem este teto a linha voltaria a `sending` a cada tique, indefinidamente,
    // e o disparo nunca terminaria: `recover-stuck-messages` NÃO toca em
    // `queued` de propósito (esse estado tem dono), então ninguém mais a
    // resolveria. Uma campanha eternamente "1 na fila" é o mesmo tipo de mentira
    // de progresso que aquele cron existe para acabar.
    if (desfecho === "adiado") {
      const tentativas = (orfao.attempts ?? 0) + 1;
      if (tentativas >= TENTATIVAS_ANTES_DE_DESISTIR) {
        await db.marcarDestinatario(orfao.id, org, {
          status: "failed",
          message_id: orfao.message_id,
          error:
            "O canal não aceitou esta mensagem depois de várias tentativas. " +
            "Confira a conexão e use 'Tentar de novo'.",
        });
        resumo.falhados += 1;
      } else {
        await db.marcarDestinatario(orfao.id, org, {
          status: "sending",
          message_id: orfao.message_id,
          incrementarTentativa: true,
        });
      }
    }
  }

  // ─── 2. Pré-voo do canal ──────────────────────────────────────────────────
  const sessao = await db.sessaoDoCanal(org, disparo.channel_session_id);
  const recusa = recusaDoCanal(sessao, disparo.provider);
  if (recusa) {
    // A diferença entre as duas recusas é se o problema se resolve SOZINHO.
    //
    // Número desconectado volta: alguém lê o QR e a sessão vira WORKING de novo,
    // sem tocar no disparo. Esse fica `running` com relógio adiado, e a frase da
    // tela ("continua sozinho quando ele voltar") passa a ser verdade — que é o
    // ponto: promessa de tela que o estado não cumpre é pior que nenhuma.
    //
    // Conexão apagada, arquivada ou que trocou de tipo NÃO volta: alguém tem de
    // criar um disparo novo. Esse é `paused`, e fica esperando gente.
    await db.atualizarDisparo(disparo.id, org, {
      ...(recusa.reversivel
        ? {
            status: "running" as const,
            next_send_at: new Date(
              deps.relogio().getTime() + ESPERA_DE_CANAL_CAIDO_MS,
            ).toISOString(),
          }
        : { status: "paused" as const, next_send_at: null }),
      pause_reason: "operador",
      pause_detail: recusa.frase,
      claimed_until: null,
    });
    await db.avisarNaCentral({
      organizationId: org,
      bulkSendId: disparo.id,
      titulo: "Um disparo em massa parou",
      corpo: recusa.frase,
      severidade: recusa.reversivel ? "info" : "warn",
    });
    resumo.adiados += 1;
    return;
  }
  // `recusa` nulo prova que a sessão existe — `recusaDoCanal` recusa `null`.
  const canal = sessao as SessaoDoCanal;

  // ─── 3. O laço de envio ───────────────────────────────────────────────────
  const capabilities = capabilitiesOf(disparo.provider as ChannelProvider);
  const { knobs, numberActivatedAt } = await db.configDePacing(org, disparo.channel_session_id);
  let falhasSeguidas = 0;

  for (;;) {
    const agora = deps.relogio();

    const estado = await db.estadoDePacing(org, disparo.channel_session_id, {
      agora,
      timezone: knobs.timezone,
      numberActivatedAt,
    });

    // A régua anti-ban é a do produto inteiro — não há segunda cópia aqui.
    const decisao = decidePacing({
      now: agora,
      knobs,
      state: estado,
      crmDailyLimit: canal.daily_message_limit,
      banRisk: capabilities.banRisk,
      rng: deps.rng,
    });

    if (!decisao.allow) {
      // Veto NÃO é erro: é ritmo. A frase instrutiva em pt-BR já vem pronta do
      // motor (com hora e fuso) e vai direto para a tela — a UI não reescreve.
      await db.atualizarDisparo(disparo.id, org, {
        status: "running",
        next_send_at: decisao.nextAllowedAt.toISOString(),
        pause_reason: decisao.code,
        pause_detail: decisao.reason,
        claimed_until: null,
      });
      if (decisao.code !== "outside_window") {
        // Fora da janela é rotina (toda noite). Cap batido é informação que o
        // operador precisa: a campanha vai levar dias, e ele não sabe disso.
        await db.avisarNaCentral({
          organizationId: org,
          bulkSendId: disparo.id,
          titulo: "Um disparo em massa está esperando o limite do número",
          corpo: decisao.reason,
          severidade: "info",
        });
      }
      resumo.adiados += 1;
      return;
    }

    const ritmo = intervaloEfetivo({
      intervaloDoOperador: disparo.interval_ms,
      knobs,
      capabilities,
      rng: deps.rng,
    });
    // Os dois compõem: `decidePacing` dá o gap mínimo desde o último envio do
    // NÚMERO (que o agente também alimenta); `intervaloEfetivo` dá o
    // espaçamento desta CAMPANHA. Quem manda é o maior.
    //
    // ⚠️ O intervalo desconta o tempo JÁ DECORRIDO desde o último envio, e essa
    // subtração não é detalhe. Sem ela, a espera seria o intervalo inteiro a
    // cada iteração — inclusive na primeira do tique seguinte, que já começa um
    // minuto depois da anterior. Com cron de 1 min e intervalo de 30s a
    // campanha andaria a 90s por mensagem: três vezes mais devagar do que o
    // operador pediu, sem nada na tela explicando por quê.
    //
    // `Infinity` quando o número nunca enviou: não há gap a respeitar, e a
    // primeira mensagem sai na hora.
    const desdeOUltimoMs = estado.lastSentAt
      ? agora.getTime() - estado.lastSentAt.getTime()
      : Number.POSITIVE_INFINITY;
    const faltaDoIntervalo = Math.max(0, ritmo.intervaloMs - desdeOUltimoMs);
    const esperaMs = Math.max(decisao.waitMs, faltaDoIntervalo);

    if (agora.getTime() + esperaMs > limite) {
      // Não cabe neste tique. A campanha É o cursor: nada se perde.
      await db.atualizarDisparo(disparo.id, org, {
        status: "running",
        next_send_at: new Date(agora.getTime() + esperaMs).toISOString(),
        pause_reason: null,
        pause_detail: null,
        claimed_until: null,
      });
      return;
    }

    const destinatario = await db.proximoPendente(disparo.id, org);
    if (!destinatario) {
      // Fila de `pending` vazia NÃO é o mesmo que campanha terminada: pode
      // haver gente em voo (`sending`), esperando o canal aceitar. Fechar aqui
      // marcaria "concluído" com destinatário pendurado — e o dossiê mostraria
      // "restantes: 1" ao lado de um selo de concluído, que é a contradição que
      // faz o operador parar de confiar na tela.
      const emVoo = await db.emVooOrfaos(disparo.id, org);
      if (emVoo.length > 0) {
        await db.atualizarDisparo(disparo.id, org, {
          status: "running",
          next_send_at: new Date(agora.getTime() + ESPERA_DE_EM_VOO_MS).toISOString(),
          claimed_until: null,
        });
        resumo.adiados += 1;
        return;
      }

      await db.atualizarDisparo(disparo.id, org, {
        status: "done",
        finished_at: agora.toISOString(),
        next_send_at: null,
        pause_reason: null,
        pause_detail: null,
        claimed_until: null,
      });
      resumo.concluidos += 1;
      return;
    }

    // ─── As guardas, de novo, no momento do envio ─────────────────────────
    //
    // A lista foi montada antes; `is_blocked` muda NO MEIO da campanha (a
    // pessoa responde "PARAR" e a ingestão grava). Reconferir é o que honra o
    // opt-out já no próximo destinatário, em vez de no próximo disparo.
    const guarda = checarContato(destinatario.contato);
    if (!guarda.ok) {
      await db.marcarDestinatario(destinatario.id, org, {
        status: "skipped",
        // `no_contact` não existe no vocabulário do banco (a FK garante o
        // contato); se chegar, é linha corrompida e vira o motivo mais próximo.
        skip_reason: guarda.reason === "no_contact" ? "contact_merged" : guarda.reason,
      });
      resumo.pulados += 1;
      // Pulo NÃO consome pacing nem espera: nada saiu pelo número.
      continue;
    }

    if (esperaMs > 0) await deps.dormir(esperaMs);

    // Marca ANTES de sair: entre isto e o desfecho há uma chamada de rede, e é
    // esta linha que a varredura do passo 1 encontra se o processo morrer.
    await db.marcarDestinatario(destinatario.id, org, {
      status: "sending",
      incrementarTentativa: true,
    });

    let mensagem: MensagemEnviada;
    try {
      mensagem = await deps.enviar(disparo, destinatario);
    } catch (err) {
      // Exceção aqui é o transporte tendo estourado ANTES de a linha existir —
      // ou o 403 de `is_blocked` do próprio handler, que chega como exceção.
      const texto = err instanceof Error ? err.message : String(err);
      const bloqueou = /bloqueou o atendimento/i.test(texto);
      await db.marcarDestinatario(destinatario.id, org, {
        status: bloqueou ? "skipped" : "failed",
        skip_reason: bloqueou ? "contact_blocked" : null,
        error: bloqueou ? null : texto,
      });
      if (bloqueou) {
        resumo.pulados += 1;
        continue;
      }
      resumo.falhados += 1;
      falhasSeguidas += 1;
      if (await pausarSeEmSerie(deps, disparo, falhasSeguidas)) return;
      continue;
    }

    const parou = await adotarDesfecho(deps, disparo, destinatario.id, mensagem, resumo);
    if (parou === "sucesso") {
      falhasSeguidas = 0;
    } else if (parou === "adiado") {
      // A mensagem ficou em `queued`: o canal não a aceitou ainda. Insistir com
      // os próximos 400 é martelar um canal que já disse que não está pronto.
      await db.atualizarDisparo(disparo.id, org, {
        status: "running",
        next_send_at: new Date(deps.relogio().getTime() + Math.max(esperaMs, 60_000)).toISOString(),
        claimed_until: null,
      });
      resumo.adiados += 1;
      return;
    } else {
      falhasSeguidas += 1;
      if (await pausarSeEmSerie(deps, disparo, falhasSeguidas)) return;
    }
  }
}

/**
 * Traduz a LINHA da mensagem no desfecho do destinatário. Devolve o que
 * aconteceu para o chamador decidir se continua.
 */
async function adotarDesfecho(
  deps: DisparoDeps,
  disparo: DisparoEmVoo,
  destinatarioId: string,
  mensagem: MensagemEnviada,
  resumo: ResumoDoTique,
): Promise<"sucesso" | "falha" | "adiado"> {
  const org = disparo.organization_id;
  const desfecho = desfechoDoEnvio("bulk_send", mensagem);

  if (desfecho.status === "success") {
    const agora = deps.relogio();
    await deps.db.marcarDestinatario(destinatarioId, org, {
      status: "sent",
      message_id: mensagem.id,
      sent_at: agora.toISOString(),
      error: null,
    });
    // Só o que o canal ACEITOU entra no ledger — é o que torna o disparo
    // visível ao anti-ban do agente, que lê a mesma tabela.
    await deps.db.registrarEnvioNoLedger(org, disparo.channel_session_id, agora);
    resumo.enviados += 1;
    return "sucesso";
  }

  if (desfecho.status === "postponed") {
    // Fica em `sending` COM `message_id`: o tique seguinte lê aquela mensagem e
    // adota o desfecho dela. Voltar para `pending` aqui reenviaria.
    await deps.db.marcarDestinatario(destinatarioId, org, {
      status: "sending",
      message_id: mensagem.id,
    });
    return "adiado";
  }

  await deps.db.marcarDestinatario(destinatarioId, org, {
    status: "failed",
    message_id: mensagem.id,
    error: desfecho.error ?? "A mensagem não saiu.",
  });
  resumo.falhados += 1;
  return "falha";
}

async function pausarSeEmSerie(
  deps: DisparoDeps,
  disparo: DisparoEmVoo,
  falhasSeguidas: number,
): Promise<boolean> {
  if (falhasSeguidas < FALHAS_SEGUIDAS_PARA_PAUSAR) return false;
  const corpo =
    `${falhasSeguidas} envios seguidos falharam neste disparo. ` +
    "O número pode estar com problema — confira a conexão antes de continuar.";
  await deps.db.atualizarDisparo(disparo.id, disparo.organization_id, {
    status: "paused",
    pause_reason: "operador",
    pause_detail: corpo,
    next_send_at: null,
    claimed_until: null,
  });
  await deps.db.avisarNaCentral({
    organizationId: disparo.organization_id,
    bulkSendId: disparo.id,
    titulo: "Um disparo em massa foi pausado por falhas seguidas",
    corpo,
    severidade: "critical",
  });
  return true;
}

/**
 * `null` = o canal serve. Caso contrário, a frase que vai para a tela e se o
 * problema se resolve SOZINHO.
 *
 * `reversivel: true` = o disparo fica `running` com o relógio adiado e retoma
 * sem ninguém tocar nele. `false` = precisa de gente, e fica `paused`. A
 * distinção existe porque a frase mostrada tem de bater com o comportamento:
 * dizer "continua sozinho" e ficar pausado para sempre é a pior das duas.
 *
 * O `provider` congelado é comparado com o da sessão viva: re-parear o número
 * no meio da fila trocaria o canal em silêncio, e uma campanha montada como
 * template sairia por um canal que não sabe template (ou o contrário).
 */
export interface RecusaDoCanal {
  frase: string;
  reversivel: boolean;
}

export function recusaDoCanal(
  sessao: SessaoDoCanal | null,
  providerDoDisparo: string,
): RecusaDoCanal | null {
  if (!sessao) {
    return {
      frase:
        "A conexão deste disparo não existe mais. Crie um disparo novo escolhendo outra conexão.",
      reversivel: false,
    };
  }
  if (sessao.archived_at) {
    return {
      frase:
        "A conexão deste disparo foi excluída da Central de Conexões. Crie um disparo novo escolhendo outra conexão.",
      reversivel: false,
    };
  }
  if (sessao.provider !== providerDoDisparo) {
    return {
      frase:
        "A conexão deste disparo mudou de tipo depois que ele foi criado. " +
        "Crie um disparo novo para a conexão como ela está agora — o conteúdo montado não serve mais.",
      reversivel: false,
    };
  }
  if (sessao.status !== "WORKING") {
    return {
      frase:
        "O número deste disparo não está conectado no momento. Reconecte em Conexões — o disparo continua sozinho quando ele voltar.",
      reversivel: true,
    };
  }
  return null;
}
