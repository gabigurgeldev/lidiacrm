/**
 * A REGRA ÚNICA de "esta organização pode usar o sistema?" — pura, sem I/O.
 *
 * Tela (`app/app/layout.tsx`), API (`requireRole`) e motores de automação
 * perguntam aqui, por meio de `acessoDaOrganizacao` (`./servico.ts`). Três
 * lugares decidindo cada um do seu jeito dariam o caso clássico: a tela bloqueia
 * e a IA continua respondendo no WhatsApp de quem não pagou.
 *
 * ═══ Calculado das DATAS ═══
 *
 * Não existe flag `bloqueado`. O webhook de pagamento empurra `pago_ate` e a
 * pessoa entra no mesmo segundo; quando a data passa, o bloqueio acontece
 * sozinho — nenhum cron precisa acordar para isso, nas duas direções.
 *
 * ═══ A ordem das perguntas importa ═══
 *
 *   1. cobrança desligada (sem ASAAS_API_KEY) → liberado;
 *   2. isenta → liberado;
 *   3. cancelada → liberada até `pago_ate`, e mais nada (cancelar não ganha
 *      tolerância: é decisão de quem cancelou, não esquecimento);
 *   4. pago até depois de agora → ativa;
 *   5. dentro do trial → trial;
 *   6. já pagou alguma vez e está dentro da tolerância → tolerancia;
 *   7. senão bloqueado: `trial_vencido` se nunca pagou, `inadimplente` se já.
 *
 * Tolerância é só para quem JÁ pagou: trial vencido bloqueia no dia seguinte,
 * sem prorrogação — decisão do dono do produto.
 */

export type StatusDaAssinatura = "trial" | "ativa" | "inadimplente" | "cancelada";

export interface LinhaDeAssinatura {
  status: StatusDaAssinatura | string;
  isenta: boolean;
  trial_termina_em: string | null;
  pago_ate: string | null;
}

export interface ConfigDeCobranca {
  /** `false` quando não há `ASAAS_API_KEY` — tudo liberado. */
  ligada: boolean;
  diasTolerancia: number;
}

export type MotivoDeAcesso =
  | "cobranca_desligada"
  | "isenta"
  | "ativa"
  | "trial"
  | "tolerancia"
  | "cancelada"
  | "trial_vencido"
  | "inadimplente";

export interface EstadoDeAcesso {
  liberado: boolean;
  motivo: MotivoDeAcesso;
  /** Até quando o estado atual vale (fim do trial, pago até, fim da tolerância). */
  ateQuando: string | null;
  /** Dias inteiros até `ateQuando`, arredondados para cima; null quando não se aplica. */
  diasRestantes: number | null;
  /** Mostrar aviso de "assine / regularize" no app. */
  emAviso: boolean;
}

const DIA_MS = 24 * 60 * 60 * 1000;
/** Nos últimos N dias do trial o app avisa. */
export const DIAS_DE_AVISO_DO_TRIAL = 3;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function restantes(ate: number, agora: number): number {
  return Math.max(0, Math.ceil((ate - agora) / DIA_MS));
}

export function estadoDeAcesso(
  a: LinhaDeAssinatura,
  cfg: ConfigDeCobranca,
  agora: Date = new Date(),
): EstadoDeAcesso {
  const t = agora.getTime();
  const livre = (motivo: MotivoDeAcesso): EstadoDeAcesso => ({
    liberado: true,
    motivo,
    ateQuando: null,
    diasRestantes: null,
    emAviso: false,
  });

  if (!cfg.ligada) return livre("cobranca_desligada");
  if (a.isenta) return livre("isenta");

  const pagoAte = ms(a.pago_ate);
  const trialAte = ms(a.trial_termina_em);

  if (a.status === "cancelada") {
    const vale = pagoAte !== null && t < pagoAte;
    return {
      liberado: vale,
      motivo: "cancelada",
      ateQuando: a.pago_ate,
      diasRestantes: pagoAte !== null ? restantes(pagoAte, t) : null,
      emAviso: vale,
    };
  }

  if (pagoAte !== null && t < pagoAte) {
    return {
      liberado: true,
      motivo: "ativa",
      ateQuando: a.pago_ate,
      diasRestantes: restantes(pagoAte, t),
      emAviso: false,
    };
  }

  if (trialAte !== null && t < trialAte) {
    const dias = restantes(trialAte, t);
    return {
      liberado: true,
      motivo: "trial",
      ateQuando: a.trial_termina_em,
      diasRestantes: dias,
      emAviso: dias <= DIAS_DE_AVISO_DO_TRIAL,
    };
  }

  if (pagoAte !== null) {
    const fimTolerancia = pagoAte + cfg.diasTolerancia * DIA_MS;
    if (t < fimTolerancia) {
      return {
        liberado: true,
        motivo: "tolerancia",
        ateQuando: new Date(fimTolerancia).toISOString(),
        diasRestantes: restantes(fimTolerancia, t),
        emAviso: true,
      };
    }
    return {
      liberado: false,
      motivo: "inadimplente",
      ateQuando: new Date(fimTolerancia).toISOString(),
      diasRestantes: 0,
      emAviso: true,
    };
  }

  return {
    liberado: false,
    motivo: "trial_vencido",
    ateQuando: a.trial_termina_em,
    diasRestantes: 0,
    emAviso: true,
  };
}


// ---------------------------------------------------------------------------
// "Pago até" — derivado das cobranças, nunca somado por evento
// ---------------------------------------------------------------------------

/** Status de cobrança do Asaas que contam como paga. */
export const STATUS_PAGOS = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

/** O mesmo dia do mês seguinte, em UTC; 31/01 → 28 ou 29/02 (nunca pula para março). */
export function mesDepois(dataIso: string): string {
  const d = new Date(dataIso.length === 10 ? `${dataIso}T00:00:00Z` : dataIso);
  const dia = d.getUTCDate();
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes()));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return alvo.toISOString();
}

/**
 * `pago_ate` = o maior "vencimento + 1 mês" entre as cobranças PAGAS.
 *
 * ⚠️ Por que derivar e não somar: o cartão manda `PAYMENT_CONFIRMED` e, dias
 * depois, `PAYMENT_RECEIVED` da MESMA cobrança; o Asaas também reentrega. Somar
 * "+1 mês" a cada evento daria meses de graça. Recalcular do conjunto é
 * idempotente por construção — e o estorno sai de graça: a cobrança estornada
 * deixa de contar e o `pago_ate` recua sozinho.
 */
export function pagoAteDasCobrancas(
  cobrancas: Array<{ status: string; vencimento: string | null }>,
): string | null {
  let maior: string | null = null;
  for (const c of cobrancas) {
    if (!STATUS_PAGOS.has(c.status) || !c.vencimento) continue;
    const ate = mesDepois(c.vencimento);
    if (!maior || ate > maior) maior = ate;
  }
  return maior;
}
