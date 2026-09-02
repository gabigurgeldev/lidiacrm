import type { EventHandler } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { acordarFrentesQueEsperam, CHAVE_DO_ACORDADOR } from "./acordar-por-evento";
import { EVENTO_DE_SUBFLUXO } from "./engine";
import { EVENTOS_QUE_ACORDAM } from "./nodes/paralelo";

/**
 * O acordador no barramento de eventos.
 *
 * ⚠️ A lista de eventos é DERIVADA do que o bloco de espera oferece na tela
 * (`EVENTOS_QUE_ACORDAM`), e não uma lista literal aqui. Duas listas divergem no
 * primeiro evento novo, e a divergência é silenciosa do pior jeito: a pessoa
 * escolhe "o lead ser ganho" no formulário, o fluxo dorme, o evento acontece — e
 * ninguém acorda ninguém, porque este arquivo nunca soube desse evento.
 *
 * Mesmo desenho de `trigger-matcher.handler.ts`, que deriva os dele do registry.
 */
export const flowEventWakerHandler: EventHandler = {
  key: CHAVE_DO_ACORDADOR,
  // `EVENTO_DE_SUBFLUXO` entra aqui e NÃO em `EVENTOS_QUE_ACORDAM`: aquela lista
  // é o que a pessoa escolhe no formulário, e ninguém espera "um sub-fluxo
  // terminou" de propósito — quem cria essa espera é o bloco "Chamar outro
  // fluxo", sozinho.
  events: [...EVENTOS_QUE_ACORDAM, EVENTO_DE_SUBFLUXO],
  async handle(row) {
    return acordarFrentesQueEsperam(createAdminClient(), row);
  },
};
