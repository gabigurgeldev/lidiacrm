"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `crm.assign_owner` — entrega o lead a alguém. */
export function CrmAssignOwnerForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Quem fica com o lead")}>
        <Input
          value={String(config.user_id ?? "")}
          onChange={(e) => aoMudarConfig({ ...config, user_id: e.target.value })}
          placeholder={t("Cole o identificador, ou use a variável do bloco de distribuição")}
          data-testid="campo-dono"
        />
        <Dica
          texto={t(
            "Use {{vars.dono_escolhido}} para pegar quem o bloco de distribuição escolheu, ou cole o identificador de uma pessoa.",
          )}
        />
      </Campo>
    </Secao>
  );
}
