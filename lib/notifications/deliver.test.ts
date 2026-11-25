import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("./emit", () => ({ emitNotification: vi.fn() }));
vi.mock("./som", () => ({ tocarAviso: vi.fn(async () => true) }));

import { toast } from "sonner";
import { entregarAviso } from "./deliver";
import { emitNotification } from "./emit";
import { gravarCanal } from "./prefs";
import { tocarAviso } from "./som";

describe("entregarAviso", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("manda toast e push quando os dois canais estão ligados", () => {
    entregarAviso({
      category: "lead_assigned",
      kind: "lead_assigned",
      title: "Lead atribuído",
      body: "Carlos",
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(emitNotification).toHaveBeenCalledTimes(1);
  });

  it("omite push quando o canal está desligado", () => {
    gravarCanal("lead_won", "push", false);
    entregarAviso({
      category: "lead_won",
      kind: "lead_won",
      title: "Lead ganho",
      body: "ok",
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(emitNotification).not.toHaveBeenCalled();
  });

  it("toca o som MESMO com Push e No sistema desligados (era o defeito)", () => {
    gravarCanal("message", "push", false);
    gravarCanal("message", "in_app", false);
    entregarAviso({
      category: "message",
      kind: "message_inbound",
      title: "Maria",
      body: "oi",
      chaveDoSom: "msg-1",
      grupoDoSom: "contato:c1",
    });
    expect(tocarAviso).toHaveBeenCalledWith(
      expect.objectContaining({ som: "message", chave: "message_inbound:msg-1", grupo: "contato:c1" }),
    );
    expect(toast).not.toHaveBeenCalled();
    expect(emitNotification).not.toHaveBeenCalled();
  });

  it("o Push sai sempre mudo: o som é do tocarAviso, que respeita a preferência", () => {
    entregarAviso({ category: "mention", kind: "mention", title: "Ana", body: "@você", tag: "n1" });
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({ silenciar: true }));
  });
});

