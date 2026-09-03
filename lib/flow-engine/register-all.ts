/**
 * Flow Engine — o único lugar onde os nós entram no registry.
 *
 * Espelha `lib/automation/actions/register-all.ts`. Quem precisa do registry
 * cheio importa DESTE arquivo, nunca dos nós direto: importar um nó solto o
 * registraria por efeito colateral de import, e o conjunto passaria a depender
 * de qual arquivo alguém importou primeiro.
 */

import { registrarNo } from "./registry";
import {
  crmAssignOwner,
  notifyInternal,
  whatsappNotifyUser,
} from "./nodes/avisos";
import {
  crmAddTag,
  crmDonoRespondeu,
  routingRedistribute,
  routingRoundRobin,
} from "./nodes/crm-e-roteamento";
import { logicEnd, logicIf, logicWait, triggerLeadCreated } from "./nodes/logica";
import {
  flowCall,
  logicAwaitEvent,
  logicFork,
  logicLoop,
  logicMerge,
} from "./nodes/paralelo";

let registrado = false;

/** Idempotente: chamar duas vezes não duplica nem lança. */
export function garantirNosRegistrados(): void {
  if (registrado) return;
  registrarNo(triggerLeadCreated);
  registrarNo(logicIf);
  registrarNo(logicWait);
  registrarNo(logicEnd);
  registrarNo(logicFork);
  registrarNo(logicMerge);
  registrarNo(logicLoop);
  registrarNo(logicAwaitEvent);
  registrarNo(flowCall);
  registrarNo(crmAddTag);
  registrarNo(crmAssignOwner);
  registrarNo(crmDonoRespondeu);
  registrarNo(routingRoundRobin);
  registrarNo(routingRedistribute);
  registrarNo(whatsappNotifyUser);
  registrarNo(notifyInternal);
  registrado = true;
}

/** Só para teste, junto de `limparRegistroParaTeste`. */
export function esquecerRegistroParaTeste(): void {
  registrado = false;
}
