"use client";
/**
 * Ao lado dos limites por atendimento: quanto este agente DE FATO gastou nos
 * atendimentos reais, e quantos o limite do formulário teria cortado
 * (`lib/ai/agents/consumo-por-atendimento.ts`). Limite escolhido no escuro ou
 * corta atendimento bom, ou não protege nada.
 */
import * as React from "react";

import { useT } from "@/hooks/i18n/useT";
import {
  resumirConsumo,
  type GastoDeUmAtendimento,
} from "@/lib/ai/agents/consumo-por-atendimento";

interface Props {
  agentId: string;
  limites: { tokens: number; centavos: number };
}

type Estado =
  | { tipo: "carregando" }
  | { tipo: "erro" }
  | { tipo: "pronto"; atendimentos: GastoDeUmAtendimento[]; dias: number };

function dolar(centavos: number | null): string {
  if (centavos === null) return "—";
  const d = centavos / 100;
  return `US$ ${(d > 0 && d < 0.01 ? d.toFixed(4) : d.toFixed(2)).replace(".", ",")}`;
}

export function ConsumoPorAtendimento({ agentId, limites }: Props) {
  const t = useT();
  const [estado, setEstado] = React.useState<Estado>({ tipo: "carregando" });

  React.useEffect(() => {
    let vivo = true;
    fetch(`/api/v1/ai/agents/${agentId}/consumo?days=30`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          data?: { atendimentos: GastoDeUmAtendimento[]; janela_em_dias: number };
        };
        if (!vivo) return;
        setEstado(
          res.ok && json.data
            ? { tipo: "pronto", atendimentos: json.data.atendimentos, dias: json.data.janela_em_dias }
            : { tipo: "erro" },
        );
      })
      .catch(() => {
        if (vivo) setEstado({ tipo: "erro" });
      });
    return () => {
      vivo = false;
    };
  }, [agentId]);

  if (estado.tipo === "carregando") {
    return <p className="text-xs text-muted-foreground">{t("Lendo quanto este agente costuma gastar…")}</p>;
  }
  if (estado.tipo === "erro") {
    return <p className="text-xs text-muted-foreground">{t("Não foi possível ler o consumo deste agente.")}</p>;
  }
  if (estado.atendimentos.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="consumo-sem-historico">
        {t("Ainda sem atendimentos medidos. Depois dos primeiros, aparece aqui quanto cada um gastou.")}
      </p>
    );
  }

  const r = resumirConsumo(estado.atendimentos, limites);
  return (
    <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2 text-xs" data-testid="consumo-por-atendimento">
      <p>
        {t("Nos últimos")} {estado.dias} {t("dias,")} {r.atendimentos} {t("atendimentos. Metade gastou até")}{" "}
        <strong>{(r.tokens.p50 ?? 0).toLocaleString()}</strong> {t("tokens e")} <strong>{dolar(r.centavos.p50)}</strong>;{" "}
        {t("95% até")} <strong>{(r.tokens.p95 ?? 0).toLocaleString()}</strong> {t("tokens e")}{" "}
        <strong>{dolar(r.centavos.p95)}</strong>.
      </p>
      <p className={r.cortados > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"} data-testid="consumo-cortados">
        {r.cortados > 0
          ? `${t("Com os limites acima,")} ${r.cortados} ${t("deles teriam sido cortados.")}`
          : t("Com os limites acima, nenhum deles teria sido cortado.")}
      </p>
    </div>
  );
}
