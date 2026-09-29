/**
 * O MOTOR DA MENSAGEM DE ANIVERSÁRIO — uma rodada, todas as organizações.
 *
 * Roda de hora em hora (`app/api/v1/cron/aniversarios`). Para cada organização
 * com a chave ligada:
 *
 *   1. calcula o dia e a hora LOCAIS da empresa (`organizations.timezone`);
 *   2. antes da hora escolhida, não faz nada — a rodada seguinte decide;
 *   3. RESERVA o dia (`aniversario_envios`, UNIQUE por organização+dia). Se já
 *      estava reservado, o dia já foi feito: nada de segundo disparo — o cron é
 *      reentregável e a pessoa não pode ganhar os parabéns duas vezes;
 *   4. busca quem faz aniversário hoje e cria UM disparo em massa com eles.
 *
 * O ENVIO NÃO MORA AQUI. É o do disparo (`lib/bulk-send/motor.ts`): ritmo
 * anti-banimento da conexão, janela de horário, opt-out conferido de novo antes
 * de cada mensagem, reenvio e tela de resultados. Uma segunda máquina de envio
 * nasceria sem tudo isso — e sem os próximos consertos que a primeira receber.
 *
 * ── Quando dá errado ─────────────────────────────────────────────────────────
 *
 * Falhar ao criar o disparo DEVOLVE a reserva: a próxima hora tenta de novo
 * (até o dia acabar), e a Central recebe um aviso para quem pode consertar
 * (conexão excluída, modelo reprovado). "Ninguém pode receber" (todos
 * bloqueados, por exemplo) NÃO é falha: o dia fica registrado com total zero.
 *
 * Dependências injetadas — o mesmo desenho de `lib/flow-engine/engine.ts` —
 * para o teste exercitar a regra sem banco.
 */
import type { AniversarioConfig } from "@/lib/schemas/aniversario";

import { ddmm, diaLocal, mmddDoDia } from "./datas";

export type OrgComAniversario = {
  id: string;
  timezone: string | null;
  config: AniversarioConfig;
};

export type ResultadoDaCriacao =
  | { ok: true; disparoId: string; vaoReceber: number }
  | { ok: false; semDestinatario: true }
  | { ok: false; semDestinatario?: false; motivo: string };

export type AniversarioDeps = {
  orgsComAniversarioLigado(): Promise<OrgComAniversario[]>;
  /** Gate de assinatura. Ausente = liberado (testes, instalação sem cobrança). */
  podeOperar?(orgId: string): Promise<boolean>;
  /** `true` = reservou agora; `false` = o dia já estava reservado. */
  reservarDia(orgId: string, dataLocal: string): Promise<boolean>;
  liberarDia(orgId: string, dataLocal: string): Promise<void>;
  concluirDia(orgId: string, dataLocal: string, r: { bulkSendId: string | null; total: number }): Promise<void>;
  aniversariantes(orgId: string, mmdd: string[]): Promise<string[]>;
  criarDisparo(org: OrgComAniversario, nome: string, contactIds: string[]): Promise<ResultadoDaCriacao>;
  avisar(orgId: string, motivo: string): Promise<void>;
};

export type ResumoDaRodada = {
  organizacoes: number;
  disparos: number;
  destinatarios: number;
  semAniversariante: number;
  antesDaHora: number;
  jaFeito: number;
  bloqueadas: number;
  falhas: number;
};

export async function rodarAniversarios(deps: AniversarioDeps, agora: Date = new Date()): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = {
    organizacoes: 0,
    disparos: 0,
    destinatarios: 0,
    semAniversariante: 0,
    antesDaHora: 0,
    jaFeito: 0,
    bloqueadas: 0,
    falhas: 0,
  };

  const orgs = await deps.orgsComAniversarioLigado();
  for (const org of orgs) {
    if (!org.config.ativo || !org.config.canal_id || !org.config.modo) continue;
    resumo.organizacoes++;

    const hoje = diaLocal(agora, org.timezone);
    if (hoje.hora < org.config.hora) {
      resumo.antesDaHora++;
      continue;
    }

    // Antes de reservar: uma organização bloqueada por falta de pagamento não
    // pode "gastar" o dia — se ela pagar às 15h, ainda recebe os parabéns hoje.
    if (deps.podeOperar && !(await deps.podeOperar(org.id))) {
      resumo.bloqueadas++;
      continue;
    }

    try {
      if (!(await deps.reservarDia(org.id, hoje.data))) {
        resumo.jaFeito++;
        continue;
      }
    } catch {
      resumo.falhas++;
      continue;
    }

    try {
      const ids = await deps.aniversariantes(org.id, mmddDoDia(hoje.ano, hoje.mes, hoje.dia));
      if (ids.length === 0) {
        await deps.concluirDia(org.id, hoje.data, { bulkSendId: null, total: 0 });
        resumo.semAniversariante++;
        continue;
      }

      const r = await deps.criarDisparo(org, `Aniversariantes de ${ddmm(hoje)}`, ids);
      if (r.ok) {
        await deps.concluirDia(org.id, hoje.data, { bulkSendId: r.disparoId, total: r.vaoReceber });
        resumo.disparos++;
        resumo.destinatarios += r.vaoReceber;
      } else if (r.semDestinatario) {
        // Todos bloqueados/sem opt-in: não é defeito, é a lista do dia.
        await deps.concluirDia(org.id, hoje.data, { bulkSendId: null, total: 0 });
        resumo.semAniversariante++;
      } else {
        await deps.liberarDia(org.id, hoje.data);
        await deps.avisar(org.id, r.motivo);
        resumo.falhas++;
      }
    } catch (err) {
      await deps.liberarDia(org.id, hoje.data).catch(() => undefined);
      await deps
        .avisar(org.id, err instanceof Error ? err.message : "erro inesperado")
        .catch(() => undefined);
      resumo.falhas++;
    }
  }
  return resumo;
}
