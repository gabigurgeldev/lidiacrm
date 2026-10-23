import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O `migrate` aplica o baseline numa transação só: UM comando que viole
 * constraint desfaz o baseline inteiro, e o app sobe com o banco velho sem
 * ninguém ver. Foi assim de 2026-10-15 a 2026-10-23 em produção — o culpado
 * era o remapeamento de conversas de contato fundido, que movia a conversa
 * para o contato de destino mesmo quando ele já tinha conversa 1:1 no número
 * e estourava `uniq_conversations_1to1_per_contact_session` (migration 0247).
 *
 * Esta cerca impede o passo cru de voltar.
 */
const BASELINE = readFileSync(path.resolve(__dirname, "../../supabase/baseline.sql"), "utf8");

const REMAP_CRU =
  /update\s+public\.conversations\s+t\s+set\s+contact_id\s*=\s*c\.is_merged_into\s+from\s+public\.contacts\s+c\s+where\s+t\.contact_id\s*=\s*c\.id\s+and\s+c\.is_merged_into\s+is\s+not\s+null\s*;/gi;

describe("baseline: remapear conversa de contato fundido não estoura o índice 1:1", () => {
  it("o passo cru (sem olhar o destino) não existe mais", () => {
    expect(BASELINE.match(REMAP_CRU) ?? []).toEqual([]);
  });

  it("os três blocos usam a forma segura (controle positivo: a regex enxerga o arquivo)", () => {
    const seguros = BASELINE.match(/Remapeamento SEGURO \(migration 0247\)/g) ?? [];
    expect(seguros.length).toBe(3);
  });
});
