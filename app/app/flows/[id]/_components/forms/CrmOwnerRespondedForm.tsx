"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Secao, type PropsDoFormulario } from "./shared";

/** `crm.owner_responded` — pergunta se o vendedor já falou com o lead. */
export function CrmOwnerRespondedForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Contar a partir de quando")}>
        <Select
          value={String(config.contar_a_partir_de ?? "desde_o_inicio_do_fluxo")}
          onValueChange={(v) => aoMudarConfig({ ...config, contar_a_partir_de: v })}
        >
          <SelectTrigger data-testid="campo-contar-a-partir">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desde_o_inicio_do_fluxo">{t("Do começo do fluxo")}</SelectItem>
            <SelectItem value="desde_a_atribuicao">
              {t("De quando o lead foi entregue")}
            </SelectItem>
          </SelectContent>
        </Select>
      </Campo>
    </Secao>
  );
}
