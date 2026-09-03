"use client";

import { useT } from "@/hooks/i18n/useT";

import { CorpoDoRodizio } from "./corpoDoRodizio";
import { Aviso, type PropsDoFormulario } from "./shared";

/** `routing.random` — sorteio, com o aviso do que o sorteio faz de verdade. */
export function RoutingRandomForm(props: PropsDoFormulario) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <Aviso
        texto={t(
          "Sorteia entre quem está disponível. Sorteio concentra: três leads seguidos para a mesma pessoa é resultado normal. Para dividir parelho, use 'Distribuir para um vendedor'.",
        )}
      />
      <CorpoDoRodizio {...props} />
    </div>
  );
}
