"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { useT } from "@/hooks/i18n/useT";
import type { FlowBranch } from "@/lib/flow-engine/types";
import { cn } from "@/lib/utils";

export interface DadosDoNo extends Record<string, unknown> {
  rotulo: string;
  tipo: string;
  categoria: string;
  branches: FlowBranch[];
  erros?: string[];
}

/** Uma cor por categoria. A cor diz o que o bloco FAZ antes de a pessoa ler. */
const COR_DA_CATEGORIA: Record<string, string> = {
  trigger: "border-l-emerald-500",
  logic: "border-l-sky-500",
  crm: "border-l-violet-500",
  whatsapp: "border-l-green-600",
  routing: "border-l-amber-500",
  notify: "border-l-rose-500",
};

/**
 * UM HANDLE POR SAÍDA, com o rótulo ao lado.
 *
 * Com um handle só não há onde ligar "a saída da segunda regra", e bolinhas
 * iguais sem nome trocariam um problema por outro — quem monta precisa ver de
 * qual regra a linha está saindo. É a mesma decisão do construtor de follow-up,
 * pelo mesmo motivo.
 */
export function NoDoFluxo({ id, data, selected }: NodeProps) {
  const t = useT();
  const d = data as DadosDoNo;
  const temErro = (d.erros?.length ?? 0) > 0;
  const ehGatilho = d.categoria === "trigger";

  return (
    <div
      className={cn(
        "w-60 rounded-md border border-l-4 bg-background shadow-sm",
        COR_DA_CATEGORIA[d.categoria] ?? "border-l-muted",
        selected === true && "ring-2 ring-primary ring-offset-1",
        temErro && "border-destructive ring-2 ring-destructive ring-offset-1",
      )}
      data-testid={`no-${id}`}
      title={temErro ? d.erros!.join("; ") : undefined}
    >
      {/* O gatilho não recebe ligação: nada pode voltar para o começo. */}
      {!ehGatilho && <Handle type="target" position={Position.Top} />}

      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium">{d.rotulo}</p>
        <p className="truncate text-xs text-muted-foreground">{t(d.tipo)}</p>
      </div>

      {temErro && (
        <p
          className="border-t border-destructive/30 px-3 py-1.5 text-xs leading-snug text-destructive"
          data-testid={`erro-do-no-${id}`}
        >
          {d.erros![0]}
        </p>
      )}

      {d.branches.length > 0 && (
        <ul className="border-t" data-testid={`saidas-${id}`}>
          {d.branches.map((ramo) => (
            <li
              key={ramo.id}
              className={cn(
                "relative flex items-center gap-1.5 border-t px-3 py-1 first:border-t-0",
                // A saída de escape não veio de uma regra que a pessoa escreveu:
                // itálico e apagada, para se ler como "o resto cai aqui".
                ramo.kind === "fallback" && "italic text-muted-foreground",
              )}
              data-testid={`saida-${id}-${ramo.id}`}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  ramo.kind === "fallback" ? "bg-muted-foreground/50" : "bg-primary",
                )}
              />
              <span className="truncate text-xs leading-tight">{t(ramo.label)}</span>
              <Handle type="source" id={ramo.id} position={Position.Right} style={{ top: "50%" }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
