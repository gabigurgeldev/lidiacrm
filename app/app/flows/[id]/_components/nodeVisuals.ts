import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import {
  ArrowsClockwise,
  ArrowsMerge,
  ArrowsSplit,
  Hourglass,
  Repeat,
  Bell,
  ChatCircle,
  ChatCircleText,
  Clock,
  Flag,
  FlowArrow,
  Funnel,
  GitBranch,
  Megaphone,
  PaperPlaneTilt,
  Play,
  Question,
  Tag,
  UserCircle,
  UsersThree,
} from "@/lib/ui/icons";

/**
 * Identidade visual por tipo/categoria de bloco do Flow Engine: ícone e cor.
 *
 * Mora no CLIENTE, e não no registry (`lib/flow-engine/nodes/*.ts`), porque o
 * registry roda em runtime puro — sem DOM — e ícone é componente React. O
 * casamento é pelo `type` string que `GET /api/v1/flows/nodes` já devolve;
 * este arquivo não precisa de nenhuma mudança no backend.
 *
 * Precedente: `app/app/ai/followups/[id]/_components/nodes/nodeVisuals.ts`,
 * o mesmo padrão no construtor de follow-up — e a origem dos tokens abaixo.
 *
 * Um tipo novo registrado no backend sem entrada aqui NÃO quebra a tela — cai
 * no ícone de categoria e, faltando também esse, no genérico (`Question`).
 * Resiliente de propósito: o dia em que alguém registrar um nó novo e esquecer
 * deste arquivo, a paleta continua utilizável, só menos bonita. (Formulário
 * faltando é outra história — ver `nodeFormRegistry.ts`, que tem gate.)
 *
 * ## Por que token semântico e não cor crua do Tailwind
 *
 * A versão anterior deste arquivo pintava a borda do cartão com
 * `border-l-emerald-500`, `border-l-sky-500` e afins. Cor crua não acompanha o
 * tema (o produto tem claro e escuro, e os dois saem do mesmo conjunto de
 * variáveis) e não diz NADA sobre o papel do bloco — `sky-500` é uma cor,
 * `info` é um significado. O construtor irmão já usava os tokens; os dois
 * construtores pintando o mesmo tipo de coisa por regras diferentes era a
 * divergência a fechar.
 *
 * A exceção deliberada é `whatsapp`: ali o verde é a MARCA do canal, não o
 * accent do produto — a mesma razão pela qual `.ios-disco` fixa
 * `--color-success-*` no cartão de conexão. Trocar por um token de UI faria o
 * bloco de WhatsApp perder o único sinal que o liga ao aplicativo que ele usa.
 */
export interface VisualDoNo {
  /** Fundo + texto do disco do ícone (cabeçalho do painel de ajustes). */
  chip: string;
  /** Borda esquerda do cartão no quadro. */
  borda: string;
}

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
  "whatsapp.send_to_lead": ChatCircleText,
  "whatsapp.bulk_send": Megaphone,
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

/**
 * Uma cor por categoria. A cor diz o que o bloco FAZ antes de a pessoa ler.
 *
 * - `trigger` → accent: é o começo, o único bloco que age sozinho.
 * - `logic` → info: decide e espera, não muda nada no funil.
 * - `crm` → accent forte: mexe no lead de verdade.
 * - `whatsapp` → success: verde de marca (ver a nota no topo).
 * - `routing` → warning: decide de QUEM é o lead, o que dá briga se errar.
 * - `notify` → error: chama alguém — é o bloco que interrompe uma pessoa.
 */
export const VISUAL_DA_CATEGORIA: Record<string, VisualDoNo> = {
  trigger: { chip: "bg-accent-soft text-accent", borda: "border-l-accent-500" },
  logic: { chip: "bg-info-bg text-info-fg", borda: "border-l-info" },
  crm: { chip: "bg-accent text-accent-foreground", borda: "border-l-accent-700" },
  whatsapp: { chip: "bg-success-bg text-success-fg", borda: "border-l-success" },
  routing: { chip: "bg-warning-bg text-warning-fg", borda: "border-l-warning" },
  notify: { chip: "bg-error-bg text-error-fg", borda: "border-l-error" },
};

/** O visual de quem não tem categoria conhecida — cinza, nunca uma cor errada. */
export const VISUAL_PADRAO: VisualDoNo = {
  chip: "bg-muted text-muted-foreground",
  borda: "border-l-muted",
};

export function iconeDoNo(type: string, category: string): PhosphorIcon {
  return ICONE_DO_TIPO[type] ?? ICONE_DA_CATEGORIA[category] ?? Question;
}
