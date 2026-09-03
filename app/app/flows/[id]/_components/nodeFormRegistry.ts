import type { ComponentType } from "react";

import { CrmHandoffToAgentForm } from "./forms/CrmHandoffToAgentForm";
import { LogicChoiceMenuForm } from "./forms/LogicChoiceMenuForm";
import { RoutingFixedOrderForm } from "./forms/RoutingFixedOrderForm";
import { RoutingRandomForm } from "./forms/RoutingRandomForm";
import { TriggerKeywordForm } from "./forms/TriggerKeywordForm";
import { TriggerWebhookForm } from "./forms/TriggerWebhookForm";
import { TriggerMessageReceivedForm } from "./forms/TriggerMessageReceivedForm";
import { CrmAddTagForm } from "./forms/CrmAddTagForm";
import { CrmAssignOwnerForm } from "./forms/CrmAssignOwnerForm";
import { CrmOwnerRespondedForm } from "./forms/CrmOwnerRespondedForm";
import { FlowCallForm } from "./forms/FlowCallForm";
import { LogicAwaitEventForm } from "./forms/LogicAwaitEventForm";
import { LogicEndForm } from "./forms/LogicEndForm";
import { LogicForkForm } from "./forms/LogicForkForm";
import { LogicIfForm } from "./forms/LogicIfForm";
import { LogicLoopForm } from "./forms/LogicLoopForm";
import { LogicMergeForm } from "./forms/LogicMergeForm";
import { LogicWaitForm } from "./forms/LogicWaitForm";
import { NotifyInternalForm } from "./forms/NotifyInternalForm";
import { RoutingRedistributeForm } from "./forms/RoutingRedistributeForm";
import { RoutingRoundRobinForm } from "./forms/RoutingRoundRobinForm";
import { TriggerLeadCreatedForm } from "./forms/TriggerLeadCreatedForm";
import { WhatsappBulkSendForm } from "./forms/WhatsappBulkSendForm";
import { WhatsappNotifyUserForm } from "./forms/WhatsappNotifyUserForm";
import { WhatsappSendToLeadForm } from "./forms/WhatsappSendToLeadForm";
import type { PropsDoFormulario } from "./forms/shared";

/**
 * O formulário de ajustes de cada bloco.
 *
 * ## Por que um MAPA e não um `switch`
 *
 * Era um `switch` de dezesseis casos dentro de um arquivo de 759 linhas, e o
 * problema não era o tamanho: era que cada bloco novo obrigava a abrir o mesmo
 * arquivo que todos os outros ocupam. Duas pessoas mexendo em blocos
 * diferentes disputavam as mesmas linhas, e ninguém conseguia ler o formulário
 * de UM bloco sem rolar por quinze.
 *
 * Um arquivo por formulário resolve as duas coisas. O mapa é só o índice.
 *
 * ## Por que um formulário POR TIPO, e não um gerado do schema Zod
 *
 * (A razão original, que continua valendo — ela veio junto do arquivo antigo.)
 * O genérico pareceria mais elegante e seria pior de usar: `duracao_ms` viraria
 * um campo numérico pedindo milissegundos, e `saidas[0].quando.itens[0].campo`
 * uma árvore de JSON. Quem monta o fluxo não conhece o schema — conhece o funil.
 *
 * ## Tipo sem entrada aqui
 *
 * Não quebra a tela: o painel mostra um aviso de "sem ajustes". Mas, ao
 * contrário do ícone (que degrada para um genérico e segue bonito o bastante),
 * formulário faltando é lacuna FUNCIONAL — o bloco existe e não dá para
 * configurar. Por isso `nodeFormRegistry.test.ts` reprova quando um tipo
 * registrado no motor não tem entrada neste mapa.
 */
export const FORMULARIO_DO_TIPO: Record<string, ComponentType<PropsDoFormulario>> = {
  "trigger.lead_created": TriggerLeadCreatedForm,
  "trigger.message_received": TriggerMessageReceivedForm,
  "trigger.keyword": TriggerKeywordForm,
  "trigger.webhook": TriggerWebhookForm,
  "logic.if": LogicIfForm,
  "logic.wait": LogicWaitForm,
  "logic.end": LogicEndForm,
  "logic.fork": LogicForkForm,
  "logic.merge": LogicMergeForm,
  "logic.loop": LogicLoopForm,
  "logic.await_event": LogicAwaitEventForm,
  "logic.choice_menu": LogicChoiceMenuForm,
  "flow.call": FlowCallForm,
  "crm.add_tag": CrmAddTagForm,
  "crm.assign_owner": CrmAssignOwnerForm,
  "crm.owner_responded": CrmOwnerRespondedForm,
  "routing.round_robin": RoutingRoundRobinForm,
  "routing.redistribute": RoutingRedistributeForm,
  "routing.random": RoutingRandomForm,
  "routing.fixed_order": RoutingFixedOrderForm,
  "crm.handoff_to_agent": CrmHandoffToAgentForm,
  "whatsapp.notify_user": WhatsappNotifyUserForm,
  "whatsapp.send_to_lead": WhatsappSendToLeadForm,
  "whatsapp.bulk_send": WhatsappBulkSendForm,
  "notify.internal": NotifyInternalForm,
};
