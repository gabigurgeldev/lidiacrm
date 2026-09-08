/**
 * `notification_phone` em `availabilityPatchSchema` — o campo que destrava o
 * bloco `whatsapp.notify_user` do motor de fluxos (antes dele não existir,
 * o bloco caía sempre em "Sem telefone cadastrado", pra sempre).
 */
import { describe, expect, it } from "vitest";

import { availabilityPatchSchema } from "@/lib/schemas/routing";

describe("availabilityPatchSchema — notification_phone", () => {
  it("⭐ aceita E.164 válido", () => {
    const r = availabilityPatchSchema.safeParse({ notification_phone: "+5511999998888" });
    expect(r.success).toBe(true);
  });

  it("⭐ aceita null — é como se limpa o telefone", () => {
    const r = availabilityPatchSchema.safeParse({ notification_phone: null });
    expect(r.success).toBe(true);
  });

  it("⭐ recusa fora do formato E.164 (sem +, letras, DDD solto)", () => {
    for (const bruto of ["5511999998888", "+55 11 99999-8888", "abc", "+55119999x888"]) {
      const r = availabilityPatchSchema.safeParse({ notification_phone: bruto });
      expect(r.success, `deveria recusar: ${bruto}`).toBe(false);
    }
  });

  it("continua aceitando um PATCH só de is_available, sem o campo novo", () => {
    const r = availabilityPatchSchema.safeParse({ is_available: true });
    expect(r.success).toBe(true);
  });
});
