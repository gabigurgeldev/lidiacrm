"use client";
import { HabilidadesDoAgente, type HabilidadeDoCatalogo } from "../HabilidadesDoAgente";
import type { PropsDaSecao } from "./estado";
import { ErroDoCampo } from "./pecas";

/** As situações que o agente sabe conduzir — skills universais, da organização e do ramo. */
export function SecaoHabilidades({
  form,
  patch,
  disabled,
  erros,
  habilidades,
}: PropsDaSecao & { habilidades: HabilidadeDoCatalogo[] }) {
  return (
    <>
      <HabilidadesDoAgente
        habilidades={habilidades}
        value={form.skill_names}
        onChange={(nomes) => patch({ skill_names: nomes })}
        disabled={disabled}
      />
      <ErroDoCampo texto={erros.skill_names} />
    </>
  );
}
