"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `logic.loop` — percorre uma lista, com teto obrigatório. */
export function LogicLoopForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  return (
    <Secao>
      <Campo rotulo={t("Lista a percorrer")}>
        <Input
          value={String(config.lista ?? "")}
          maxLength={120}
          placeholder="vars.itens"
          onChange={(e) => mudar({ lista: e.target.value })}
          data-testid="campo-lista-do-laco"
        />
        <Dica
          texto={t(
            "O caminho da lista guardada por um bloco anterior — por exemplo vars.produtos.",
          )}
        />
      </Campo>
      <Campo rotulo={t("Repetir no máximo quantas vezes?")}>
        <Input
          type="number"
          min={1}
          max={100}
          value={Number(config.max ?? 10)}
          onChange={(e) => mudar({ max: Math.min(100, Math.max(1, Number(e.target.value))) })}
          data-testid="campo-teto-do-laco"
        />
        <Dica
          texto={t(
            "O teto é obrigatório: é ele que garante que a repetição termina, mesmo se a lista vier maior do que o esperado.",
          )}
        />
      </Campo>
    </Secao>
  );
}
