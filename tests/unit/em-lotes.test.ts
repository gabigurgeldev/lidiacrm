import { describe, expect, it } from "vitest";

import { consultarEmLotes, fatiar, IDS_POR_REQUISICAO } from "@/lib/supabase/em-lotes";

/**
 * `.in()` EM LOTES — o filtro viaja na URL, e a URL tem teto.
 *
 * Medido em produção em 2026-10-27: o quadro de uma loja com algumas centenas
 * de negócios respondia "Não consegui carregar este Kanban: URI too long", e o
 * Kong registrava 414 em `crm_lead_scores`, `conversations`, `lead_state`,
 * `cron_jobs` e `webhook_events_log`. Nenhum teste via isso porque nenhum
 * teste tinha uma organização grande.
 */

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

describe("fatiar", () => {
  it("corta em fatias do tamanho pedido, preservando a ordem", () => {
    expect(fatiar([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("lista vazia não gera fatia — e portanto nenhuma ida ao banco", () => {
    expect(fatiar([])).toEqual([]);
  });

  it("recusa tamanho que nunca terminaria", () => {
    expect(() => fatiar([1], 0)).toThrow();
  });
});

describe("consultarEmLotes", () => {
  it("nenhuma URL passa do teto, e nenhum id fica de fora", async () => {
    // O que o supabase-js põe na query string: `coluna=in.(id,id,…)` com a
    // vírgula codificada (%2C). O Kong recusa por volta de 8 KB; o lote deixa
    // folga para os outros filtros da mesma URL.
    const ids = Array.from({ length: 1_234 }, (_, i) => uuid(i));
    const tamanhos: number[] = [];

    const { data, error } = await consultarEmLotes(ids, async (lote) => {
      tamanhos.push(encodeURIComponent(`in.(${lote.join(",")})`).length);
      return { data: lote.map((id) => ({ id })), error: null };
    });

    expect(error).toBeNull();
    expect(data.map((r) => r.id)).toEqual(ids);
    expect(tamanhos).toHaveLength(Math.ceil(ids.length / IDS_POR_REQUISICAO));
    expect(Math.max(...tamanhos)).toBeLessThan(4_500);
  });

  it("o primeiro erro vence e nenhuma linha parcial volta", async () => {
    // Metade dos scores apresentada como o todo parece "metade dos leads não
    // tem score" — uma mentira mais difícil de notar que a falha.
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i));
    let chamada = 0;
    const { data, error } = await consultarEmLotes(ids, async (lote) => {
      chamada++;
      return chamada === 2
        ? { data: null, error: { message: "URI too long" } }
        : { data: lote.map((id) => ({ id })), error: null };
    });

    expect(error?.message).toBe("URI too long");
    expect(data).toEqual([]);
  });

  it("sem ids, não consulta", async () => {
    let chamadas = 0;
    const { data, error } = await consultarEmLotes([], async () => {
      chamadas++;
      return { data: [], error: null };
    });
    expect({ chamadas, data, error }).toEqual({ chamadas: 0, data: [], error: null });
  });
});
