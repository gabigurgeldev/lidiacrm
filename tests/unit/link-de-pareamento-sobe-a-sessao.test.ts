/**
 * O LINK DE PAREAMENTO SOBE A SESSÃO CAÍDA — senão o QR nunca aparece.
 *
 * ## O defeito que este arquivo prende
 *
 * O link é gerado para canal caído. Em produção (canal em `FAILED`), a página
 * abria, o contador corria, e o quadro do QR ficava em branco até o link
 * expirar: o transporte só entrega QR para sessão em `SCAN_QR_CODE`, respondia
 * 422 a cada renovação, e nada no caminho do link subia a sessão. No CRM logado
 * quem faz isso é o botão "Reconectar"; o dono do celular não tem botão nenhum.
 *
 * ## O que precisa ficar preso
 *
 * - `FAILED` reinicia DESCARTANDO a credencial (logout) — o start comum
 *   reaproveita a credencial morta e volta direto para FAILED.
 * - `STOPPED`/ausente reiniciam SEM descartar — credencial viva volta sozinha.
 * - `SCAN_QR_CODE`, `STARTING` e `WORKING` não são tocados.
 * - A trava de frequência é respeitada: sem ela, sessão que volta a FAILED seria
 *   reiniciada (com logout) a cada 3s de polling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reiniciar = vi.fn();
vi.mock("@/lib/channels/reconectar", () => ({
  reiniciarSessaoDoCanal: (...args: unknown[]) => reiniciar(...args),
}));

import {
  estadoNoTransporte,
  prepararSessaoParaQr,
  reinicioNecessario,
} from "@/lib/channels/pareamento/canal";

const ALVO = { organizationId: "org-1", channelSessionId: "canal-1" };

/** Admin que devolve a linha do canal para `canalParaParear`. */
function adminCom(linha: Record<string, unknown> | null) {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) cadeia[m] = () => cadeia;
  cadeia.maybeSingle = () => Promise.resolve({ data: linha, error: null });
  return { from: () => cadeia } as never;
}

const CANAL_VIVO = { waha_session_name: "org_1_abc", archived_at: null };

function transporteResponde(status: number, corpo?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status })),
  );
}

beforeEach(() => {
  vi.stubEnv("WAHA_API_BASE_URL", "http://waha.test");
  vi.stubEnv("WAHA_API_KEY", "chave-real");
  reiniciar.mockReset();
  reiniciar.mockResolvedValue({ ok: true, status: "STARTING", nomeSessao: "org_1_abc" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("estadoNoTransporte — lê o estado VIVO, não a coluna", () => {
  it.each([
    ["SCAN_QR_CODE", "pronto"],
    ["WORKING", "conectado"],
    ["STARTING", "iniciando"],
    ["STOPPED", "parado"],
    ["FAILED", "falhou"],
  ])("%s vira %s", async (status, esperado) => {
    transporteResponde(200, { status });
    expect(await estadoNoTransporte("s")).toBe(esperado);
  });

  it("sessão inexistente no transporte (404) é 'ausente', não 'indisponível'", async () => {
    transporteResponde(404);
    expect(await estadoNoTransporte("s")).toBe("ausente");
  });

  it("transporte fora do ar é 'indisponivel' — e não lança", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await estadoNoTransporte("s")).toBe("indisponivel");
  });

  it("chave de exemplo conta como transporte ausente", async () => {
    vi.stubEnv("WAHA_API_KEY", "dev_plaintext_change_me");
    expect(await estadoNoTransporte("s")).toBe("sem_transporte");
  });
});

describe("reinicioNecessario — suave primeiro, logout só para FAILED", () => {
  it("⭐ FAILED descarta a credencial", () => {
    expect(reinicioNecessario("falhou")).toEqual({ forcar: true });
  });

  it("STOPPED e ausente sobem sem descartar", () => {
    expect(reinicioNecessario("parado")).toEqual({ forcar: false });
    expect(reinicioNecessario("ausente")).toEqual({ forcar: false });
  });

  it.each(["pronto", "iniciando", "conectado", "indisponivel", "sem_transporte"] as const)(
    "%s não é tocado",
    (estado) => {
      expect(reinicioNecessario(estado)).toBeNull();
    },
  );
});

describe("prepararSessaoParaQr", () => {
  it("⭐ canal FAILED: reinicia com logout, filtrando a organização do LINK", async () => {
    transporteResponde(200, { status: "FAILED" });
    const r = await prepararSessaoParaQr(adminCom(CANAL_VIVO), ALVO, async () => true);
    expect(reiniciar).toHaveBeenCalledWith(expect.anything(), { ...ALVO, forcar: true });
    expect(r).toEqual({ qrPronto: false, reiniciou: { forcar: true } });
  });

  it("⭐ trava de frequência fechada: NÃO reinicia", async () => {
    transporteResponde(200, { status: "FAILED" });
    const r = await prepararSessaoParaQr(adminCom(CANAL_VIVO), ALVO, async () => false);
    expect(reiniciar).not.toHaveBeenCalled();
    expect(r).toEqual({ qrPronto: false, reiniciou: null });
  });

  it("QR já disponível: não reinicia e nem consulta a trava", async () => {
    transporteResponde(200, { status: "SCAN_QR_CODE" });
    const trava = vi.fn(async () => true);
    const r = await prepararSessaoParaQr(adminCom(CANAL_VIVO), ALVO, trava);
    expect(r).toEqual({ qrPronto: true, reiniciou: null });
    expect(trava).not.toHaveBeenCalled();
    expect(reiniciar).not.toHaveBeenCalled();
  });

  it("sessão subindo (STARTING): espera, não reinicia em cima", async () => {
    transporteResponde(200, { status: "STARTING" });
    const r = await prepararSessaoParaQr(adminCom(CANAL_VIVO), ALVO, async () => true);
    expect(reiniciar).not.toHaveBeenCalled();
    expect(r.qrPronto).toBe(false);
  });

  it("canal arquivado: não sobe sessão nenhuma", async () => {
    transporteResponde(200, { status: "FAILED" });
    const r = await prepararSessaoParaQr(
      adminCom({ ...CANAL_VIVO, archived_at: "2026-10-01T00:00:00Z" }),
      ALVO,
      async () => true,
    );
    expect(reiniciar).not.toHaveBeenCalled();
    expect(r).toEqual({ qrPronto: false, reiniciou: null });
  });

  it("reinício que falha no transporte não conta como reiniciado (não audita)", async () => {
    transporteResponde(200, { status: "FAILED" });
    reiniciar.mockResolvedValue({ ok: false, codigo: "waha_error", mensagem: "x", http: 502 });
    const r = await prepararSessaoParaQr(adminCom(CANAL_VIVO), ALVO, async () => true);
    expect(r).toEqual({ qrPronto: false, reiniciou: null });
  });
});
