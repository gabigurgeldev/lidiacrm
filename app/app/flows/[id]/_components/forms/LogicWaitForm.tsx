"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `logic.wait` — espera de relógio, em minutos. */
export function LogicWaitForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const minutos = Math.round(Number(config.duracao_ms ?? 300_000) / 60_000);

  return (
    <Secao>
      <Campo rotulo={t("Esperar quantos minutos?")}>
        <Input
          type="number"
          min={5}
          max={129_600}
          value={minutos}
          onChange={(e) =>
            aoMudarConfig({ ...config, duracao_ms: Math.max(5, Number(e.target.value)) * 60_000 })
          }
          data-testid="campo-espera-minutos"
        />
        <Dica texto={t("Mínimo de 5 minutos — abaixo disso o relógio do sistema não distingue.")} />
      </Campo>
    </Secao>
  );
}
