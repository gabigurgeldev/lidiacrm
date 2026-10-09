"use client";
import { Campo, Grupo } from "@/components/ajustes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

import type { PropsDaSecao } from "./estado";
import { ErroDoCampo } from "./pecas";

/** Nome e descrição. A ordem entre agentes mora nos ajustes avançados. */
export function SecaoIdentidade({ form, patch, disabled, erros }: PropsDaSecao) {
  const t = useT();
  return (
    <Grupo titulo={t("Quem é este agente")}>
      <Campo rotulo={t("Nome")} htmlFor="name">
        <Input
          id="name"
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={disabled}
          maxLength={120}
          aria-invalid={!!erros.name}
        />
        <ErroDoCampo texto={erros.name} />
      </Campo>
      <Campo rotulo={t("Descrição")} htmlFor="description">
        <Textarea
          id="description"
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          disabled={disabled}
          rows={2}
          maxLength={2000}
        />
      </Campo>
    </Grupo>
  );
}
