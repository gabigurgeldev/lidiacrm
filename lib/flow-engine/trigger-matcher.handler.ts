import { createAdminClient } from "@/lib/supabase/admin";
import type { EventHandler } from "@/lib/event-log/dispatcher";

import { armarFluxosParaEvento, CHAVE_DO_MATCHER, eventosEscutados } from "./trigger-matcher";
// Import por efeito colateral: o registry precisa estar cheio ANTES de
// `eventosEscutados()` ser avaliado, e ele é avaliado na construção do objeto.
import "./register-all";

export const flowTriggerHandler: EventHandler = {
  key: CHAVE_DO_MATCHER,
  // DERIVADO do registry — ver `eventosEscutados`. Uma lista literal aqui
  // divergiria do catálogo de nós no primeiro gatilho novo.
  events: eventosEscutados(),
  async handle(row) {
    return armarFluxosParaEvento(createAdminClient(), row);
  },
};
