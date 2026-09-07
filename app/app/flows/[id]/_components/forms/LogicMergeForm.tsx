"use client";

import { useT } from "@/hooks/i18n/useT";

import { Aviso } from "./shared";

/** `logic.merge` — o alvo do reencontro. Quem configura é a bifurcação. */
export function LogicMergeForm() {
  const t = useT();
  return (
    <Aviso
      texto={t(
        "Aqui os caminhos que correm ao mesmo tempo voltam a ser um só. Aponte a bifurcação para este bloco.",
      )}
    />
  );
}
