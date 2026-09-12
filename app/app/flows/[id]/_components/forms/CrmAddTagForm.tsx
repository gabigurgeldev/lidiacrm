"use client";

import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `crm.add_tag` — marca o lead. */
export function CrmAddTagForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Marcador")}>
        <CampoComVariavel
          valor={String(config.tag ?? "")}
          maxLength={40}
          aoMudar={(v) => aoMudarConfig({ ...config, tag: v })}
          testid="campo-tag"
        />
        <Dica
          texto={t(
            "O marcador aceita variável: dá para marcar o lead com o que veio no gatilho, em vez de um texto fixo.",
          )}
        />
      </Campo>
    </Secao>
  );
}
