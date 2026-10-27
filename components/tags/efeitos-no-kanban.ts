import { toast } from "sonner";

/** O que a API do contato devolve quando uma tag mexeu num Kanban (`lib/tags/tag-no-kanban.ts`). */
export interface EfeitoNoKanban {
  pipeline_name: string;
  stage_name: string;
  acao: "criado" | "movido" | "ja_estava" | "ambiguo" | "falhou";
}

/**
 * Diz na tela para onde a tag levou o contato. Um lugar só para as três portas
 * que gravam tag de contato (inbox, novo contato, editar contato): o texto
 * divergiria, e o atendente leria "Contato no Kanban" numa e nada na outra.
 *
 * Devolve `true` quando algum Kanban foi tocado — quem chama decide o que reler.
 */
export function avisarEfeitosNoKanban(
  efeitos: readonly EfeitoNoKanban[] | undefined,
  t: (s: string) => string,
): boolean {
  for (const e of efeitos ?? []) {
    if (e.acao === "criado" || e.acao === "movido") {
      toast.success(`${t("Contato no Kanban")} ${e.pipeline_name} › ${e.stage_name}`);
    } else if (e.acao === "ambiguo") {
      toast.warning(`${e.pipeline_name}: ${t("o contato tem mais de um negócio aberto — mova pelo quadro.")}`);
    } else if (e.acao === "falhou") {
      toast.error(`${e.pipeline_name}: ${t("não consegui mover o negócio.")}`);
    }
  }
  return (efeitos ?? []).length > 0;
}
