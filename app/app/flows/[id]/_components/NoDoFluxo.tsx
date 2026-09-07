"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { useT } from "@/hooks/i18n/useT";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";
import type { FlowBranch } from "@/lib/flow-engine/types";
import { cn } from "@/lib/utils";
import { Question } from "@/lib/ui/icons";

import {
  ICONE_DA_CATEGORIA,
  ICONE_DO_TIPO,
  VISUAL_DA_CATEGORIA,
  VISUAL_PADRAO,
} from "./nodeVisuals";
import { aplicarValores, resumoDoBloco } from "./resumoDoBloco";

export interface DadosDoNo extends Record<string, unknown> {
  rotulo: string;
  tipo: string;
  categoria: string;
  branches: FlowBranch[];
  erros?: string[];
  /**
   * A config do bloco. O cartão só LÊ, para resumir o que o bloco faz — quem
   * escreve é o painel da direita. Ver `resumoDoBloco.ts`.
   *
   * `unknown` e não `Record<string, unknown>`: é o mesmo tipo que
   * `graph-schema.ts` dá a ela ("config opaca até o passe 2"), e apertá-lo aqui
   * obrigaria toda a cadeia do quadro a afirmar uma forma que ninguém validou.
   * Quem estreita é `configDoNo`, logo abaixo.
   */
  config?: unknown;
  /**
   * `true` só nos instantes seguintes a este nó ter sido criado por streaming
   * da IA — dispara a entrada animada (pop-in) e volta a `false`/`undefined`
   * sozinho. Nó criado manualmente nunca passa por aqui.
   */
  recemAdicionado?: boolean;
}

/** A config como objeto, ou `{}` — nunca lança, nem sobre config meio escrita. */
export function configDoNo(config: unknown): Record<string, unknown> {
  return typeof config === "object" && config !== null && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

/**
 * UM HANDLE POR SAÍDA, com o rótulo ao lado.
 *
 * Com um handle só não há onde ligar "a saída da segunda regra", e bolinhas
 * iguais sem nome trocariam um problema por outro — quem monta precisa ver de
 * qual regra a linha está saindo. É a mesma decisão do construtor de follow-up,
 * pelo mesmo motivo.
 *
 * ## A segunda linha do cartão
 *
 * Era o `type` cru (`logic.wait`). Hoje é o RESUMO DA CONFIG — ver o cabeçalho
 * de `resumoDoBloco.ts` para o porquê. Quando o tipo não tem resumo, cai na
 * `descricao` do registry, que ao menos é uma frase; e só quando nem essa
 * existe é que o `type` aparece, agora como último recurso e não como padrão.
 */
export function NoDoFluxo({ id, data, selected }: NodeProps) {
  const t = useT();
  const d = data as DadosDoNo;
  const temErro = (d.erros?.length ?? 0) > 0;
  const ehGatilho = d.categoria === "trigger";
  // Acesso de propriedade, nunca chamada de função: o linter do React
  // Compiler (`react-hooks/static-components`) aceita `mapa[chave]` como
  // referência estável dentro do render — igual a `visual.icon` no precedente
  // do follow-up (NodeCard.tsx) — mas acusa "componente criado durante a
  // renderização" para QUALQUER chamada de função, mesmo memoizada.
  const Icone = ICONE_DO_TIPO[d.tipo] ?? ICONE_DA_CATEGORIA[d.categoria] ?? Question;
  const visual = VISUAL_DA_CATEGORIA[d.categoria] ?? VISUAL_PADRAO;

  const resumo = resumoDoBloco(d.tipo, configDoNo(d.config));
  garantirNosRegistrados();
  const legenda =
    resumo !== null
      ? aplicarValores(t(resumo.chave), resumo.valores)
      : t(buscarNo(d.tipo)?.descricao ?? d.tipo);

  return (
    <div
      className={cn(
        "w-60 rounded-md border border-l-4 bg-background shadow-sm transition-shadow hover:shadow-md",
        visual.borda,
        selected === true && "ring-2 ring-primary ring-offset-1",
        temErro && "border-destructive ring-2 ring-destructive ring-offset-1",
        // Pop-in do nó que a IA acabou de criar em streaming — ver o
        // comentário de `recemAdicionado` na interface acima.
        d.recemAdicionado === true && "ia-surge",
      )}
      data-testid={`no-${id}`}
      title={temErro ? d.erros!.join("; ") : legenda}
    >
      {/* O gatilho não recebe ligação: nada pode voltar para o começo. */}
      {!ehGatilho && <Handle type="target" position={Position.Top} />}

      <div className="flex items-start gap-2 px-3 py-2">
        {/* O disco colorido é o mesmo do cabeçalho do painel de ajustes: a cor
            diz a CATEGORIA antes de a pessoa ler o texto, e num quadro de vinte
            blocos é o que separa "manda mensagem" de "decide" à distância. */}
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            visual.chip,
          )}
        >
          <Icone size={14} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{d.rotulo}</p>
          {/* Duas linhas, não uma: o resumo é uma frase, e cortá-la em 60px
              devolveria o problema que ele veio resolver. */}
          <p
            className="line-clamp-2 text-xs leading-snug text-muted-foreground"
            data-testid={`resumo-do-no-${id}`}
          >
            {legenda}
          </p>
        </div>
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
                // Exceção não é regra: ela pode ficar solta, e mostrá-la com o
                // mesmo peso das saídas escritas faz parecer que falta ligar.
                ramo.kind === "excecao" && "bg-muted/40 text-muted-foreground",
              )}
              data-testid={`saida-${id}-${ramo.id}`}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  ramo.kind === "match" ? "bg-primary" : "bg-muted-foreground/50",
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
