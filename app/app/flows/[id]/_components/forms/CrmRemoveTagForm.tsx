"use client";

import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { SugestoesDeMarcador } from "./marcador";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `crm.remove_tag` — tira o marcador do lead, ou do contato quando não há lead. */
export function CrmRemoveTagForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const tag = String(config.tag ?? "");

  return (
    <Secao>
      <Campo rotulo={t("Marcador a tirar")}>
        <CampoComVariavel
          valor={tag}
          maxLength={40}
          aoMudar={(v) => aoMudarConfig({ ...config, tag: v })}
          testid="campo-tag"
        />
        <SugestoesDeMarcador atual={tag} aoEscolher={(v) => aoMudarConfig({ ...config, tag: v })} />
        <Dica
          texto={t(
            "Tira o marcador de quem o tiver. Se o cliente não estiver marcado, o fluxo segue igual — não é erro.",
          )}
        />
      </Campo>
    </Secao>
  );
}
