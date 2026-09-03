"use client";

import { CorpoDoRodizio } from "./corpoDoRodizio";
import type { PropsDoFormulario } from "./shared";

/** `routing.redistribute` — passa o lead para outra pessoa. */
export function RoutingRedistributeForm(props: PropsDoFormulario) {
  return <CorpoDoRodizio {...props} />;
}
