"use client";

import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `crm.update_contact` — gravar no cadastro o nome que o cliente informou. */
export function CrmUpdateContactForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  return (
    <Secao>
      <Campo rotulo={t("Nome do cliente")}>
        <CampoComVariavel
          maxLength={200}
          valor={String(config.nome ?? "{{vars.nome}}")}
          aoMudar={(v) => aoMudarConfig({ ...config, nome: v })}
          testid="campo-nome-do-cliente"
        />
        <Dica
          texto={t(
            "Normalmente a variável de uma pergunta anterior. É o nome que aparece no Inbox e que o agente de IA usa.",
          )}
        />
      </Campo>
    </Secao>
  );
}
