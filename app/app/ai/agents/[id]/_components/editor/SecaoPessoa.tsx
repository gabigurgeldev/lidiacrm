"use client";
import { Grupo, LinhaInterruptor } from "@/components/ajustes";
import { useT } from "@/hooks/i18n/useT";

import { HandoffKeywordsInput } from "../HandoffKeywordsInput";
import type { PropsDaSecao } from "./estado";
import { Bloco } from "./pecas";

/**
 * As duas formas de o agente envolver uma pessoa: PASSAR a conversa (ele sai) e
 * PEDIR ajuda (ele fica). Vizinhas de propósito — quem procura uma acha a outra,
 * e a diferença entre as duas é o que o dono precisa entender.
 */
export function SecaoPessoa({ form, patch, disabled }: PropsDaSecao) {
  const t = useT();
  return (
    <>
      <Grupo titulo={t("Passar para uma pessoa")}>
        <LinhaInterruptor
          id="handoff_tool_enabled"
          titulo={t("Deixar o agente chamar uma pessoa quando perceber que não é caso dele")}
          ligado={form.handoff_tool_enabled}
          aoMudar={(v) => patch({ handoff_tool_enabled: v })}
          desabilitado={disabled}
        />
        {form.handoff_tool_enabled ? (
          // Migration 0227: uma chance de resolver antes de passar.
          <LinhaInterruptor
            id="human_request_try_first"
            titulo={t("Quando o cliente pedir uma pessoa, tentar resolver uma vez antes")}
            descricao={t(
              "Ligado: o agente oferece ajuda uma vez; se o cliente insistir, passa na hora. Desligado: passa assim que o cliente pede. Na API oficial da Meta, o pedido de pessoa deve ser atendido sem demora — prefira desligado lá.",
            )}
            ligado={form.human_request_try_first}
            aoMudar={(v) => patch({ human_request_try_first: v })}
            desabilitado={disabled}
          />
        ) : null}
        <Bloco>
          <HandoffKeywordsInput
            value={form.handoff_keywords}
            onChange={(v) => patch({ handoff_keywords: v })}
            disabled={disabled}
          />
        </Bloco>
      </Grupo>

      <Grupo
        titulo={t("Pedir ajuda sem sair da conversa")}
        rodape={t(
          "Diferente de passar a conversa: aqui o agente continua atendendo. Quando esbarra em algo que só uma pessoa resolve — aprovar um desconto, por exemplo — ele abre um pedido interno e retoma assim que for respondido.",
        )}
      >
        <LinhaInterruptor
          id="cases_enabled"
          titulo={t("Deixar o agente pedir uma tarefa a alguém e seguir conversando")}
          ligado={form.cases_enabled}
          aoMudar={(v) => patch({ cases_enabled: v })}
          desabilitado={disabled}
        />
      </Grupo>
    </>
  );
}
