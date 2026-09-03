import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import {
  ArrowsClockwise,
  ArrowsMerge,
  ArrowsSplit,
  Hourglass,
  Repeat,
  Bell,
  ChatCircle,
  Clock,
  Flag,
  FlowArrow,
  Funnel,
  GitBranch,
  PaperPlaneTilt,
  Play,
  Question,
  Tag,
  UserCircle,
  UsersThree,
} from "@/lib/ui/icons";

/**
 * Ícone por tipo/categoria de bloco do Flow Engine.
 *
 * Mora no CLIENTE, e não no registry (`lib/flow-engine/nodes/*.ts`), porque o
 * registry roda em runtime puro — sem DOM — e ícone é componente React. O
 * casamento é pelo `type` string que `GET /api/v1/flows/nodes` já devolve;
 * este arquivo não precisa de nenhuma mudança no backend.
 *
 * Precedente: `app/app/ai/followups/[id]/_components/nodes/nodeVisuals.ts`,
 * o mesmo padrão no construtor de follow-up.
 *
 * Um tipo novo registrado no backend sem entrada aqui NÃO quebra a tela — cai
 * no ícone de categoria e, faltando também esse, no genérico (`Question`).
 * Resiliente de propósito: o dia em que alguém registrar o 12º nó de fluxo e
 * esquecer deste arquivo, a paleta continua utilizável, só menos bonita.
 */
/**
 * Exportados como MAPAS, não só pela função `iconeDoNo` — o linter do React
 * Compiler (`react-hooks/static-components`) aceita acesso de propriedade
 * (`ICONE_DO_TIPO[tipo]`) como referência estável dentro do render, mas trata
 * QUALQUER chamada de função — mesmo memoizada com `useMemo` — como possível
 * criação de componente novo. `iconeDoNo` segue existindo para uso fora de
 * JSX (nenhum hoje), mas quem renderiza o ícone acessa os mapas direto.
 */
export const ICONE_DO_TIPO: Partial<Record<string, PhosphorIcon>> = {
  "trigger.lead_created": Play,
  "logic.if": GitBranch,
  "logic.wait": Clock,
  "logic.end": Flag,
  "logic.fork": ArrowsSplit,
  "logic.merge": ArrowsMerge,
  "logic.loop": Repeat,
  "logic.await_event": Hourglass,
  "flow.call": FlowArrow,
  "crm.add_tag": Tag,
  "crm.assign_owner": UserCircle,
  "crm.owner_responded": ChatCircle,
  "routing.round_robin": UsersThree,
  "routing.redistribute": ArrowsClockwise,
  "whatsapp.notify_user": PaperPlaneTilt,
  "notify.internal": Bell,
};

export const ICONE_DA_CATEGORIA: Partial<Record<string, PhosphorIcon>> = {
  trigger: Play,
  logic: GitBranch,
  crm: Funnel,
  whatsapp: PaperPlaneTilt,
  routing: UsersThree,
  notify: Bell,
};

export function iconeDoNo(type: string, category: string): PhosphorIcon {
  return ICONE_DO_TIPO[type] ?? ICONE_DA_CATEGORIA[category] ?? Question;
}
