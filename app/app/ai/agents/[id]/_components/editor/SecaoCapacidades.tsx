"use client";
import { Grupo } from "@/components/ajustes";
import { useT } from "@/hooks/i18n/useT";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";

import { BasesDoAgente, type MaterialDoAcervo } from "../BasesDoAgente";
import { IntegracoesDoAgente, type IntegracaoDoAcervo } from "../IntegracoesDoAgente";
import { ToolPicker } from "../ToolPicker";
import type { PropsDaSecao } from "./estado";
import { Bloco, ErroDoCampo } from "./pecas";

/** O que ele faz sozinho, o que ele consulta e quais sistemas externos ele chama. */
export function SecaoCapacidades({
  form,
  patch,
  disabled,
  erros,
  materiais,
  integracoes,
  emailConfigurado,
}: PropsDaSecao & {
  materiais: MaterialDoAcervo[];
  integracoes: IntegracaoDoAcervo[];
  emailConfigurado: boolean;
}) {
  const t = useT();
  return (
    <>
      <Grupo
        titulo={t("O que o agente pode fazer")}
        rodape={`${t(
          "Ligue por jornada de trabalho. O agente só consegue fazer o que estiver ligado aqui — e o que estiver ligado, ele fará sozinho durante o atendimento.",
        )} ${t("Máximo de")} ${TETO_TOOLS_POR_AGENTE} ${t("capacidades por agente.")}`}
      >
        <Bloco>
          <ToolPicker value={form.tool_ids} onChange={(ids) => patch({ tool_ids: ids })} disabled={disabled} />
          <ErroDoCampo texto={erros.tool_ids} />
        </Bloco>
      </Grupo>

      {/* O acervo que este assistente consulta (0181) */}
      <BasesDoAgente
        materiais={materiais}
        value={form.knowledge_source_ids}
        onChange={(ids) => patch({ knowledge_source_ids: ids })}
        disabled={disabled}
      />

      {/* Os sistemas externos que ele consulta (Integrações via API, 0223) */}
      <IntegracoesDoAgente
        integracoes={integracoes}
        emailConfigurado={emailConfigurado}
        value={form.api_endpoint_ids}
        onChange={(ids) => patch({ api_endpoint_ids: ids })}
        disabled={disabled}
      />
    </>
  );
}
