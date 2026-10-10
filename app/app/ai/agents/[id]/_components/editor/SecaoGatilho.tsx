"use client";
import { Grupo } from "@/components/ajustes";
import { useT } from "@/hooks/i18n/useT";

import { TriggerEditor } from "../TriggerEditor";
import type { PropsDaSecao } from "./estado";
import { Bloco } from "./pecas";

export function SecaoGatilho({
  form,
  patch,
  disabled,
  roteador,
}: PropsDaSecao & { roteador: { routerId: string; routerName: string } | null }) {
  const t = useT();
  return (
    <Grupo titulo={t("Quando ele entra em ação")}>
      <Bloco>
        <TriggerEditor
          value={form.trigger_config}
          onChange={(v) => patch({ trigger_config: v })}
          disabled={disabled}
          roteador={roteador}
        />
      </Bloco>
    </Grupo>
  );
}
