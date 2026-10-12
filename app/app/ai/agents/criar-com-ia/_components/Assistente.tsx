"use client";
/**
 * O assistente de agentes: "Criar novo" ou "Corrigir existente".
 *
 * O modo vive na URL (`?modo=corrigir&agente=<id>`): o botão "Corrigir com IA"
 * do editor abre direto no agente certo, e recarregar não troca de modo.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Segmentado } from "@/components/ajustes";
import { useT } from "@/hooks/i18n/useT";
import type { MapaDePacotes } from "@/lib/ai/agents/construtor/capacidades";

import { CriarComIa } from "../_client";
import { CorrigirAgente, type AgenteParaCorrigir } from "./Corrigir";
import type { Canal } from "./Revisao";

type Modo = "criar" | "corrigir";

export function Assistente({
  canais,
  mapa,
  agentes,
}: {
  canais: Canal[];
  mapa: MapaDePacotes;
  agentes: AgenteParaCorrigir[];
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const modo: Modo = params.get("modo") === "corrigir" ? "corrigir" : "criar";

  const mudar = (proximo: Modo) => {
    const q = new URLSearchParams(params.toString());
    if (proximo === "criar") {
      q.delete("modo");
      q.delete("agente");
    } else {
      q.set("modo", "corrigir");
    }
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <Segmentado<Modo>
        valor={modo}
        aoMudar={mudar}
        rotuloAcessivel={t("O que fazer")}
        className="self-start"
        testid="assistente-modo"
        opcoes={[
          { valor: "criar", rotulo: t("Criar novo"), testid: "assistente-modo-criar" },
          { valor: "corrigir", rotulo: t("Corrigir existente"), testid: "assistente-modo-corrigir" },
        ]}
      />
      {modo === "criar" ? (
        <CriarComIa canais={canais} mapa={mapa} />
      ) : (
        <CorrigirAgente agentes={agentes} agenteInicial={params.get("agente") ?? undefined} mapa={mapa} />
      )}
    </div>
  );
}
