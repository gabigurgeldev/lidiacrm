"use client";

import { CorpoDoRodizio } from "./corpoDoRodizio";
import type { PropsDoFormulario } from "./shared";

/** `routing.round_robin` — reveza entre quem está disponível. */
export function RoutingRoundRobinForm(props: PropsDoFormulario) {
  return <CorpoDoRodizio {...props} />;
}
