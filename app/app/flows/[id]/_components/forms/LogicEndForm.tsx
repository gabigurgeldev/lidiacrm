"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `logic.end` — o rótulo com que a execução aparece na tela de Execuções. */
export function LogicEndForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Como registrar o fim")}>
        <Input
          value={String(config.desfecho ?? "concluido")}
          maxLength={40}
          onChange={(e) => aoMudarConfig({ ...config, desfecho: e.target.value })}
          data-testid="campo-desfecho"
        />
        <Dica
          texto={t(
            "Aparece na tela de Execuções, para você separar o que deu certo do que não deu.",
          )}
        />
      </Campo>
    </Secao>
  );
}
