"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Secao, type PropsDoFormulario } from "./shared";

/** `crm.add_tag` — marca o lead. */
export function CrmAddTagForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Marcador")}>
        <Input
          value={String(config.tag ?? "")}
          maxLength={40}
          onChange={(e) => aoMudarConfig({ ...config, tag: e.target.value })}
          data-testid="campo-tag"
        />
      </Campo>
    </Secao>
  );
}
