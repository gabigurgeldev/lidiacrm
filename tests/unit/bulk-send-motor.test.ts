/**
 * O MOTOR DO DISPARO, com relógio e banco falsos.
 *
 * O caso mais importante deste arquivo é o de nome mais chato — "mensagem que
 * volta `failed` sem lançar exceção". `sendMessageHandler` NÃO lança quando o
 * envio falha: marca a linha de `messages` e devolve normalmente. Um motor que
 * lesse "não lançou" como "enviado" mostraria "500 enviados" com o transporte
 * fora do ar. É o defeito MEDIDO que `lib/automation/desfecho-do-envio.ts`
 * existe para matar, e aqui ele é vigiado nos três desfechos possíveis.
 */
import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import type { MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import {
  ESPERA_DE_CANAL_CAIDO_MS,
  FALHAS_SEGUIDAS_PARA_PAUSAR,
  TENTATIVAS_ANTES_DE_DESISTIR,
  houveEfeito,
  recusaDoCanal,
  rodarTiqueDeDisparo,
  type DestinatarioPendente,
  type DisparoDb,
  type DisparoDeps,
  type DisparoEmVoo,
  type EmVooOrfao,
  type PatchDoDestinatario,
  type PatchDoDisparo,
  type SessaoDoCanal,
} from "@/lib/bulk-send/motor";

// 12:00 em America/Sao_Paulo (UTC-3) — dentro da janela 7h-22h.
const DENTRO_DA_JANELA = new Date("2026-09-01T15:00:00Z");
// 03:00 em America/Sao_Paulo — fora da janela.
const FORA_DA_JANELA = new Date("2026-09-01T06:00:00Z");

const DISPARO: DisparoEmVoo = {
  id: "d1",
  organization_id: "org-a",
  channel_session_id: "sess-1",
  provider: "waha",
  mode: "freeform",
  body: "Promoção de setembro",
  template_name: null,
  template_language: null,
  template_values: {},
  interval_ms: 5_000,
};

const SESSAO_BOA: SessaoDoCanal = {
  id: "sess-1",
  provider: "waha",
  status: "WORKING",
  archived_at: null,
  daily_message_limit: 300,
};

function contato(over: Record<string, unknown> = {}) {
  return { id: "c1", phone_number: "+5511999998888", is_blocked: false, ...over };
}

interface Bancada {
  db: DisparoDb;
  patchesDoDisparo: PatchDoDisparo[];
  patchesDoDestinatario: Array<{ id: string; patch: PatchDoDestinatario }>;
  avisos: Array<{ titulo: string; severidade: string; corpo: string }>;
  ledger: number;
}

function montarBancada(opcoes: {
  disparos?: DisparoEmVoo[];
  sessao?: SessaoDoCanal | null;
  pendentes?: DestinatarioPendente[];
  orfaos?: EmVooOrfao[];
  mensagens?: Record<string, MensagemEnviada>;
  sentToday?: number;
  claimLanca?: boolean;
  numberActivatedAt?: Date | null;
  lastSentAt?: Date | null;
}): Bancada {
  const pendentes = [...(opcoes.pendentes ?? [])];
  const bancada: Partial<Bancada> = {
    patchesDoDisparo: [],
    patchesDoDestinatario: [],
    avisos: [],
    ledger: 0,
  };

  const db: DisparoDb = {
    promoverAgendados: async () => 0,
    reclamarDisparos: async () => {
      if (opcoes.claimLanca) throw new Error("banco fora do ar");
      return opcoes.disparos ?? [DISPARO];
    },
    sessaoDoCanal: async () => (opcoes.sessao === undefined ? SESSAO_BOA : opcoes.sessao),
    configDePacing: async () => ({
      knobs: PACING_DEFAULTS,
      // Número formado por padrão: sem isto todo teste bateria no cap de
      // warm-up de 20/dia e mediria a coisa errada.
      numberActivatedAt:
        opcoes.numberActivatedAt === undefined
          ? new Date("2026-01-01T00:00:00Z")
          : opcoes.numberActivatedAt,
    }),
    // Repassa `numberActivatedAt` porque a ponte real
    // (`lib/bulk-send/pacing-supabase.ts`) repassa — e é do STATE, não da
    // config, que `decidePacing` lê a idade do número. Um duble que devolvesse
    // `null` aqui faria todo número parecer recém-ativado, e todo caso deste
    // arquivo bateria no degrau de warm-up medindo a coisa errada.
    estadoDePacing: async (_org, _sess, entrada) => ({
      lastSentAt: opcoes.lastSentAt ?? null,
      sentToday: opcoes.sentToday ?? 0,
      numberActivatedAt: entrada.numberActivatedAt,
    }),
    emVooOrfaos: async () => opcoes.orfaos ?? [],
    lerMensagem: async (_org, id) => opcoes.mensagens?.[id] ?? null,
    proximoPendente: async () => pendentes.shift() ?? null,
    marcarDestinatario: async (id, _org, patch) => {
      bancada.patchesDoDestinatario!.push({ id, patch });
    },
    atualizarDisparo: async (_id, _org, patch) => {
      bancada.patchesDoDisparo!.push(patch);
    },
    registrarEnvioNoLedger: async () => {
      bancada.ledger! += 1;
    },
    avisarNaCentral: async (e) => {
      bancada.avisos!.push({ titulo: e.titulo, severidade: e.severidade, corpo: e.corpo });
    },
  };

  bancada.db = db;
  return bancada as Bancada;
}

function deps(bancada: Bancada, over: Partial<DisparoDeps> = {}): DisparoDeps {
  return {
    db: bancada.db,
    relogio: () => DENTRO_DA_JANELA,
    dormir: async () => {},
    enviar: async () => ({ id: "m1", status: "sent" }),
    rng: () => 0,
    ...over,
  };
}

describe("ritmo e janela — o veto não é erro", () => {
  it("janela fechada adia sem enviar nada e sem falhar", async () => {
    const b = montarBancada({ pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }] });
    const r = await rodarTiqueDeDisparo(deps(b, { relogio: () => FORA_DA_JANELA }));

    expect(r.enviados).toBe(0);
    expect(r.falhados).toBe(0);
    expect(r.adiados).toBe(1);
    expect(b.patchesDoDisparo[0]!.pause_reason).toBe("outside_window");
    // O disparo continua `running`: quem retoma é o relógio, não uma pessoa.
    expect(b.patchesDoDisparo[0]!.status).toBe("running");
    // A frase instrutiva vem do motor de pacing e vai VERBATIM para a tela.
    expect(b.patchesDoDisparo[0]!.pause_detail).toMatch(/fora da janela de envio/);
  });

  it("fora da janela NÃO enche a Central — é rotina de toda noite", async () => {
    const b = montarBancada({ pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }] });
    await rodarTiqueDeDisparo(deps(b, { relogio: () => FORA_DA_JANELA }));
    expect(b.avisos).toEqual([]);
  });

  it("cap diário batido adia E avisa — o operador precisa saber que vai levar dias", async () => {
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
      sentToday: 300,
    });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.enviados).toBe(0);
    expect(r.adiados).toBe(1);
    expect(b.patchesDoDisparo[0]!.pause_reason).toBe("daily_cap");
    expect(b.avisos).toHaveLength(1);
    expect(b.avisos[0]!.severidade).toBe("info");
  });

  it("número em warm-up bate o cap do degrau, não o do CRM", async () => {
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
      // Número ativado hoje: primeiro degrau, 20/dia.
      numberActivatedAt: DENTRO_DA_JANELA,
      sentToday: 20,
    });
    const r = await rodarTiqueDeDisparo(deps(b));
    expect(r.enviados).toBe(0);
    expect(b.patchesDoDisparo[0]!.pause_reason).toBe("warmup_cap");
  });
});

describe("o desfecho vem do ESTADO DA MENSAGEM, nunca da ausência de exceção", () => {
  it("mensagem que volta `sent` conta como enviada e entra no ledger", async () => {
    const b = montarBancada({ pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }] });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.enviados).toBe(1);
    expect(b.ledger).toBe(1);
    const marcado = b.patchesDoDestinatario.find((p) => p.patch.status === "sent");
    expect(marcado?.patch.message_id).toBe("m1");
  });

  /** O caso central: o handler NÃO lançou, e mesmo assim ninguém recebeu. */
  it("mensagem que volta `failed` SEM exceção conta como falha, não como envio", async () => {
    const b = montarBancada({ pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }] });
    const r = await rodarTiqueDeDisparo(
      deps(b, {
        enviar: async () => ({ id: "m1", status: "failed", error_code: "waha_error" }),
      }),
    );

    expect(r.enviados).toBe(0);
    expect(r.falhados).toBe(1);
    // Falha NÃO entra no ledger: o ledger mede o que SAIU pelo número, e
    // contar tentativa frustrada gastaria cota de warm-up que ninguém usou.
    expect(b.ledger).toBe(0);
    const marcado = b.patchesDoDestinatario.find((p) => p.patch.status === "failed");
    // Frase de tela, não código cru — `fraseDaFalhaDeCanal` traduziu.
    expect(marcado?.patch.error).toMatch(/serviço de WhatsApp/i);
  });

  it("mensagem em `queued` fica em voo COM message_id e adia o disparo", async () => {
    const b = montarBancada({ pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }] });
    const r = await rodarTiqueDeDisparo(
      deps(b, { enviar: async () => ({ id: "m1", status: "queued" }) }),
    );

    expect(r.enviados).toBe(0);
    expect(r.falhados).toBe(0);
    expect(r.adiados).toBe(1);
    // `sending` com message_id é o que impede o reenvio no tique seguinte.
    const ultimo = b.patchesDoDestinatario.at(-1)!;
    expect(ultimo.patch.status).toBe("sending");
    expect(ultimo.patch.message_id).toBe("m1");
  });
});

describe("retomada depois de reinício — nunca reenviar", () => {
  it("órfão SEM message_id volta para a fila", async () => {
    const b = montarBancada({ orfaos: [{ id: "r9", message_id: null }], pendentes: [] });
    await rodarTiqueDeDisparo(deps(b));
    expect(b.patchesDoDestinatario[0]).toEqual({ id: "r9", patch: { status: "pending" } });
  });

  it("órfão COM message_id adota o desfecho da mensagem em vez de reenviar", async () => {
    let enviosFeitos = 0;
    const b = montarBancada({
      orfaos: [{ id: "r9", message_id: "m9" }],
      mensagens: { m9: { id: "m9", status: "delivered" } },
      pendentes: [],
    });
    const r = await rodarTiqueDeDisparo(
      deps(b, {
        enviar: async () => {
          enviosFeitos += 1;
          return { id: "mX", status: "sent" };
        },
      }),
    );

    expect(enviosFeitos).toBe(0);
    expect(r.enviados).toBe(1);
    expect(b.patchesDoDestinatario[0]!.patch.status).toBe("sent");
  });

  it("órfão cuja mensagem sumiu volta para a fila", async () => {
    const b = montarBancada({ orfaos: [{ id: "r9", message_id: "sumiu" }], pendentes: [] });
    await rodarTiqueDeDisparo(deps(b));
    expect(b.patchesDoDestinatario[0]!.patch.status).toBe("pending");
  });
});

describe("as guardas no momento do envio", () => {
  it("quem bloqueou DEPOIS da montagem vira pulado, não falha", async () => {
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato({ is_blocked: true }) }],
    });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.pulados).toBe(1);
    expect(r.falhados).toBe(0);
    expect(b.patchesDoDestinatario[0]!.patch).toMatchObject({
      status: "skipped",
      skip_reason: "contact_blocked",
    });
  });

  it("o 403 do handler também vira pulado — o veto dele é o mesmo", async () => {
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
    });
    const r = await rodarTiqueDeDisparo(
      deps(b, {
        enviar: async () => {
          throw new Error("Contato bloqueou o atendimento.");
        },
      }),
    );

    expect(r.pulados).toBe(1);
    expect(r.falhados).toBe(0);
  });

  it("contato anonimizado é pulado com o motivo próprio", async () => {
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato({ is_anonymized: true }) }],
    });
    const r = await rodarTiqueDeDisparo(deps(b));
    expect(r.pulados).toBe(1);
    expect(b.patchesDoDestinatario[0]!.patch.skip_reason).toBe("contact_anonymized");
  });

  it("pulo não gasta pacing — o número não enviou nada", async () => {
    const b = montarBancada({
      pendentes: [
        { id: "r1", contact_id: "c1", contato: contato({ is_blocked: true }) },
        { id: "r2", contact_id: "c2", contato: contato() },
      ],
    });
    await rodarTiqueDeDisparo(deps(b));
    expect(b.ledger).toBe(1); // só o segundo
  });
});

describe("o intervalo desconta o tempo já decorrido", () => {
  /**
   * O defeito que este bloco vigia: somar o intervalo INTEIRO a cada iteração
   * ignora que o tique anterior terminou um minuto atrás. Com cron de 1 min e
   * intervalo de 30s, a campanha andaria a 90s por mensagem — três vezes mais
   * devagar do que o operador pediu, e sem nada na tela explicando.
   *
   * O sintoma é mudo do pior jeito: nada quebra, nada fica vermelho, e a
   * campanha simplesmente demora. Quem reclamar vai ouvir "é o anti-ban".
   */
  it("último envio há mais tempo que o intervalo NÃO faz esperar de novo", async () => {
    const esperas: number[] = [];
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
      // Intervalo do disparo é 5s; o último envio foi há 60s.
      lastSentAt: new Date(DENTRO_DA_JANELA.getTime() - 60_000),
    });
    await rodarTiqueDeDisparo(
      deps(b, { dormir: async (ms) => { esperas.push(ms); } }),
    );

    expect(b.ledger).toBe(1);
    // Zero espera: o gap já foi cumprido pelo relógio entre os dois tiques.
    expect(esperas.every((ms) => ms === 0), `esperou ${esperas.join(",")}ms à toa`).toBe(true);
  });

  it("último envio recente AINDA faz esperar o que falta, não o intervalo inteiro", async () => {
    const esperas: number[] = [];
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
      // Intervalo 5s, último envio há 2s: faltam 3s, não 5.
      lastSentAt: new Date(DENTRO_DA_JANELA.getTime() - 2_000),
    });
    await rodarTiqueDeDisparo(
      deps(b, { dormir: async (ms) => { esperas.push(ms); } }),
    );

    expect(esperas).toHaveLength(1);
    expect(esperas[0]).toBe(3_000);
  });

  it("número que nunca enviou não espera nada na primeira mensagem", async () => {
    const esperas: number[] = [];
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
      lastSentAt: null,
    });
    await rodarTiqueDeDisparo(
      deps(b, { dormir: async (ms) => { esperas.push(ms); } }),
    );
    expect(esperas.every((ms) => ms === 0)).toBe(true);
  });
});

describe("fim, orçamento e disjuntor", () => {
  it("fila vazia fecha o disparo como concluído", async () => {
    const b = montarBancada({ pendentes: [] });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.concluidos).toBe(1);
    expect(b.patchesDoDisparo[0]).toMatchObject({ status: "done", next_send_at: null });
  });

  /**
   * Fila de `pending` vazia NÃO é campanha terminada. Fechar com gente em voo
   * daria um dossiê que diz "concluído" ao lado de "restantes: 1" — a
   * contradição que faz o operador parar de confiar na tela.
   */
  it("fila vazia COM gente em voo adia, não conclui", async () => {
    const b = montarBancada({
      pendentes: [],
      orfaos: [{ id: "r9", message_id: "m9", attempts: 0 }],
      mensagens: { m9: { id: "m9", status: "queued" } },
    });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.concluidos).toBe(0);
    expect(r.adiados).toBe(1);
    expect(b.patchesDoDisparo.at(-1)).toMatchObject({ status: "running" });
  });

  /**
   * `queued` que nunca resolve não pode segurar a campanha para sempre:
   * `recover-stuck-messages` não toca em `queued` de propósito, então ninguém
   * mais o resolveria e o disparo ficaria "1 na fila" indefinidamente.
   */
  it("mensagem presa em queued vira falha depois do teto de tentativas", async () => {
    const b = montarBancada({
      pendentes: [],
      orfaos: [{ id: "r9", message_id: "m9", attempts: TENTATIVAS_ANTES_DE_DESISTIR - 1 }],
      mensagens: { m9: { id: "m9", status: "queued" } },
    });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.falhados).toBe(1);
    const ultimo = b.patchesDoDestinatario.at(-1)!;
    expect(ultimo.patch.status).toBe("failed");
    expect(ultimo.patch.error).toMatch(/Tentar de novo/);
  });

  it("abaixo do teto, a mensagem em queued continua em voo e a tentativa sobe", async () => {
    const b = montarBancada({
      pendentes: [],
      orfaos: [{ id: "r9", message_id: "m9", attempts: 0 }],
      mensagens: { m9: { id: "m9", status: "queued" } },
    });
    await rodarTiqueDeDisparo(deps(b));

    const ultimo = b.patchesDoDestinatario.at(-1)!;
    expect(ultimo.patch.status).toBe("sending");
    expect(ultimo.patch.incrementarTentativa).toBe(true);
  });

  it("orçamento estourado reagenda sem perder ninguém da fila", async () => {
    const b = montarBancada({
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
    });
    // Relógio avança 30s a cada consulta: a espera de 5s não cabe no orçamento.
    let t = DENTRO_DA_JANELA.getTime();
    const r = await rodarTiqueDeDisparo(
      deps(b, {
        relogio: () => {
          const agora = new Date(t);
          t += 30_000;
          return agora;
        },
        orcamentoMs: 10_000,
      }),
    );

    expect(r.enviados).toBe(0);
    // Ninguém foi tocado: o destinatário continua `pending` para o próximo tique.
    expect(b.patchesDoDestinatario).toEqual([]);
    expect(b.patchesDoDisparo[0]!.status).toBe("running");
    expect(b.patchesDoDisparo[0]!.next_send_at).toBeTruthy();
  });

  it("falhas seguidas pausam o disparo e gritam na Central", async () => {
    const b = montarBancada({
      pendentes: Array.from({ length: FALHAS_SEGUIDAS_PARA_PAUSAR + 3 }, (_, i) => ({
        id: `r${i}`,
        contact_id: `c${i}`,
        contato: contato(),
      })),
    });
    const r = await rodarTiqueDeDisparo(
      deps(b, { enviar: async () => ({ id: "m", status: "failed", error_code: "waha_error" }) }),
    );

    expect(r.falhados).toBe(FALHAS_SEGUIDAS_PARA_PAUSAR);
    expect(b.patchesDoDisparo.at(-1)).toMatchObject({ status: "paused" });
    expect(b.avisos.at(-1)!.severidade).toBe("critical");
  });
});

describe("pré-voo do canal", () => {
  it("número desconectado ADIA e continua sozinho — não pausa", async () => {
    const b = montarBancada({
      sessao: { ...SESSAO_BOA, status: "STOPPED" },
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
    });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.enviados).toBe(0);
    // A frase promete retomada sozinha; o estado tem de cumpri-la.
    expect(b.patchesDoDisparo[0]!.status).toBe("running");
    expect(b.patchesDoDisparo[0]!.next_send_at).toBe(
      new Date(DENTRO_DA_JANELA.getTime() + ESPERA_DE_CANAL_CAIDO_MS).toISOString(),
    );
  });

  it("conexão arquivada PAUSA — isso não se resolve sozinho", async () => {
    const b = montarBancada({
      sessao: { ...SESSAO_BOA, archived_at: "2026-08-01T00:00:00Z" },
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
    });
    await rodarTiqueDeDisparo(deps(b));
    expect(b.patchesDoDisparo[0]!.status).toBe("paused");
    expect(b.avisos[0]!.severidade).toBe("warn");
  });

  it("conexão que trocou de tipo no meio da fila pausa em vez de enviar errado", async () => {
    const b = montarBancada({
      sessao: { ...SESSAO_BOA, provider: "meta_cloud" },
      pendentes: [{ id: "r1", contact_id: "c1", contato: contato() }],
    });
    const r = await rodarTiqueDeDisparo(deps(b));
    expect(r.enviados).toBe(0);
    expect(b.patchesDoDisparo[0]!.status).toBe("paused");
    expect(b.patchesDoDisparo[0]!.pause_detail).toMatch(/mudou de tipo/);
  });

  it("recusaDoCanal separa o que volta sozinho do que precisa de gente", () => {
    expect(recusaDoCanal({ ...SESSAO_BOA, status: "STOPPED" }, "waha")!.reversivel).toBe(true);
    expect(recusaDoCanal({ ...SESSAO_BOA, archived_at: "x" }, "waha")!.reversivel).toBe(false);
    expect(recusaDoCanal(null, "waha")!.reversivel).toBe(false);
    expect(recusaDoCanal(SESSAO_BOA, "waha")).toBeNull();
  });
});

describe("a trilha do tique", () => {
  it("claim que não chega ao banco é distinguível de instalação parada", async () => {
    const b = montarBancada({ claimLanca: true });
    const r = await rodarTiqueDeDisparo(deps(b));

    expect(r.claim_falhou).toBe(true);
    expect(r.reclamados).toBe(0);
    // É o que faz o cron auditar: sem isto, tique quebrado e instalação parada
    // são a MESMA linha (todos os contadores zero).
    expect(houveEfeito(r)).toBe(true);
  });

  it("tique sem nada a fazer não audita", async () => {
    const b = montarBancada({ disparos: [] });
    const r = await rodarTiqueDeDisparo(deps(b));
    expect(houveEfeito(r)).toBe(false);
  });
});
