"use client";

import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `crm.assign_owner` — entrega o lead a alguém. */
export function CrmAssignOwnerForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Quem fica com o lead")}>
        <CampoComVariavel
          valor={String(config.user_id ?? "")}
          aoMudar={(v) => aoMudarConfig({ ...config, user_id: v })}
          placeholder={t("Cole o identificador, ou use a variável do bloco de distribuição")}
          testid="campo-dono"
        />
        <Dica
          texto={t(
            "Em 'Do fluxo', a variável dono_escolhido pega quem o bloco de distribuição escolheu. Ou cole o identificador de uma pessoa.",
          )}
        />
      </Campo>
    </Secao>
  );
}
