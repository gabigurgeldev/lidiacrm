/**
 * CANAL QUE OSCILA NÃO PODE VIRAR LAÇO DE RELEITURA.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 * Uma única aba do inbox releu a MESMA conversa (lista, conversa, mensagens e
 * notas) cerca de uma vez por segundo durante 17 minutos, sem nenhuma escrita
 * no banco. O tráfego da VPS triplicou e a CPU de 2 vCPU ficou 100% ocupada —
 * todas as organizações sentiram como "o CRM travou".
 *
 * O mecanismo: o canal voltava (SUBSCRIBED), o hook ZERAVA o recuo e disparava
 * a entrega sintética "reassinado" — que relê a tela inteira —, o canal caía de
 * novo e a próxima tentativa esperava só 1s. Recuo exponencial que zera a cada
 * volta não é recuo.
 *
 * E o canal caía porque nascia ANÔNIMO: a busca do token falhou com o servidor
 * lento e o join saiu com a anon key. Por isso o terceiro bloco: sem token, não
 * se assina.
 *
 * Os hooks rodam de verdade; só o cliente Supabase é falso, para o teste
 * controlar o que o socket responde e contar o que a tela releria.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Callback = (s: string) => void;
interface CanalFalso {
  nome: string;
  cb: Callback | null;
  on: () => CanalFalso;
  subscribe: (cb: Callback) => CanalFalso;
}

const estado = vi.hoisted(() => ({
  canais: [] as CanalFalso[],
  temToken: true,
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    channel: (nome: string) => {
      const canal: CanalFalso = {
        nome,
        cb: null,
        on: () => canal,
        subscribe: (cb: Callback) => {
          canal.cb = cb;
          return canal;
        },
      };
      estado.canais.push(canal);
      return canal;
    },
    removeChannel: () => {},
  }),
  socketTemTokenDoUsuario: async () => estado.temToken,
}));

const { useRealtimeChannel, ESTABILIDADE_DO_CANAL_MS } = await import(
  "@/hooks/realtime/useRealtimeChannel"
);

function montar() {
  const onChange = vi.fn();
  const r = renderHook(() =>
    useRealtimeChannel({
      name: "inbox-org-1",
      postgresChanges: { event: "*", table: "conversations", filter: "organization_id=eq.org-1" },
      onChange,
    }),
  );
  return { onChange, ...r };
}

/** Avança o relógio falso deixando as promessas do hook resolverem. */
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function ultimo(): CanalFalso {
  const c = estado.canais.at(-1);
  if (!c?.cb) throw new Error("nenhum canal assinado");
  return c;
}

function emitir(canal: CanalFalso, s: string) {
  act(() => canal.cb?.(s));
}

/** Entregas sintéticas — cada uma é a tela inteira relida do servidor. */
function releituras(onChange: ReturnType<typeof vi.fn>): number {
  return onChange.mock.calls.filter(
    (c) => (c[0] as { tipo?: string } | undefined)?.tipo === "reassinado",
  ).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  estado.canais.length = 0;
  estado.temToken = true;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("canal que oscila", () => {
  it("SUBSCRIBED → queda em sequência: o recuo CRESCE, e a releitura fica rara", async () => {
    const { onChange, unmount } = montar();
    await passar(0);

    // Dois minutos de um canal que volta e cai na hora, toda vez — o padrão
    // medido em produção. A cada canal novo, oscila.
    let oscilados = 0;
    for (let t = 0; t < 120_000; t += 250) {
      while (oscilados < estado.canais.length) {
        const canal = estado.canais[oscilados];
        if (!canal?.cb) break;
        emitir(canal, "SUBSCRIBED");
        emitir(canal, "CHANNEL_ERROR");
        oscilados++;
      }
      await passar(250);
    }

    // Recuo de verdade: 1+2+4+8+16+30+30+30 > 120s, então no máximo ~8
    // canais. O defeito (zerar a cada volta) dava um canal por ~1s: ~100.
    expect(estado.canais.length, "o canal reconectou em rajada").toBeLessThanOrEqual(9);
    expect(releituras(onChange), "a tela foi relida em laço").toBeLessThanOrEqual(8);
    unmount();
  });

  it("canal que FICA de pé zera o recuo — a próxima queda volta em 1s", async () => {
    const { unmount } = montar();
    await passar(0);

    // Primeira queda: recuo sobe para 1 tentativa.
    emitir(ultimo(), "CHANNEL_ERROR");
    await passar(1_000);
    expect(estado.canais).toHaveLength(2);

    // Volta e fica estável além da janela.
    emitir(ultimo(), "SUBSCRIBED");
    await passar(ESTABILIDADE_DO_CANAL_MS + 1_000);

    // Cai de novo: com o recuo zerado, a retomada é em 1s, não em 2s.
    emitir(ultimo(), "CHANNEL_ERROR");
    await passar(1_000);
    expect(estado.canais, "estabilidade não zerou o recuo").toHaveLength(3);
    unmount();
  });

  it("canal que volta mas NÃO fica de pé mantém o recuo", async () => {
    const { unmount } = montar();
    await passar(0);

    emitir(ultimo(), "CHANNEL_ERROR"); // espera 1s
    await passar(1_000);
    emitir(ultimo(), "SUBSCRIBED");
    await passar(5_000); // bem menos que a janela de estabilidade
    emitir(ultimo(), "CHANNEL_ERROR"); // a espera agora é 2s

    await passar(1_000);
    expect(estado.canais, "zerou o recuo só porque o canal voltou").toHaveLength(2);
    await passar(1_000);
    expect(estado.canais).toHaveLength(3);
    unmount();
  });
});

describe("sem token do usuário não se assina", () => {
  it("não cria canal anônimo — conta como queda e tenta de novo com recuo", async () => {
    estado.temToken = false;
    const { result, onChange, unmount } = montar();
    await passar(0);

    expect(estado.canais, "assinou sem token: o join sairia com a anon key").toHaveLength(0);
    expect(result.current.status).toBe("channel_error");

    await passar(1_000); // 1ª retomada — ainda sem token
    expect(estado.canais).toHaveLength(0);

    estado.temToken = true;
    await passar(2_000); // 2ª retomada, com recuo de 2s
    expect(estado.canais).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();

    emitir(ultimo(), "SUBSCRIBED");
    expect(result.current.status).toBe("subscribed");
    // Voltou de uma queda: a entrega sintética fecha o buraco.
    expect(releituras(onChange)).toBe(1);
    unmount();
  });

  it("desmontar no meio da espera do token não assina depois", async () => {
    estado.temToken = true;
    const { unmount } = montar();
    unmount();
    await passar(0);
    expect(estado.canais).toHaveLength(0);
  });
});
