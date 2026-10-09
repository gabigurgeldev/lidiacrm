"use client";
/**
 * Controles do kit de Ajustes — os que precisam de estado no navegador.
 * Ver `estrutura.tsx` para o porquê do kit.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { Linha } from "./estrutura";

/**
 * Trilho e gatilho do segmentado quando ele é ABA (`Tabs` do shadcn, com
 * conteúdo embaixo). O trilho vem do CSS; o ativo continua vindo das classes do
 * `TabsTrigger` — duas fontes pintando o mesmo estado decidiriam por ordem de
 * cascata, que muda sem aviso. Antes moravam como constantes locais em
 * `ConexoesShell.tsx`.
 */
export const SEGMENTADO_ABAS = "ios-segmentado";
export const GATILHO_DA_ABA = "rounded-full px-3.5 py-1.5 text-[13px]";

/** Uma linha com interruptor à direita. O rótulo inteiro é clicável. */
export function LinhaInterruptor({
  titulo,
  descricao,
  icone,
  ligado,
  aoMudar,
  desabilitado,
  testid,
  id: idDoInterruptor,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  icone?: ReactNode;
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  desabilitado?: boolean;
  testid?: string;
  /** `id` do interruptor, quando algo de fora o procura por ele (uma sonda, um teste). */
  id?: string;
}) {
  const gerado = useId();
  const id = idDoInterruptor ?? gerado;
  return (
    <Linha
      icone={icone}
      titulo={<label htmlFor={id} className="cursor-pointer">{titulo}</label>}
      descricao={descricao}
      testid={testid}
      controle={<Switch id={id} checked={ligado} onCheckedChange={aoMudar} disabled={desabilitado} />}
    />
  );
}

export interface OpcaoDoSegmentado<V extends string> {
  valor: V;
  rotulo: ReactNode;
  testid?: string;
}

/**
 * Segmentado de ESCOLHA (não de aba): um valor entre poucos, como o papel de um
 * agente. É um `radiogroup` — setas trocam a escolha, como no sistema. Para abas
 * com conteúdo embaixo, use `Tabs` com `SEGMENTADO_ABAS`.
 *
 * O ativo é `surface` sobre trilho `surface-elevated`, nunca `accent`: escolher
 * uma opção não é uma ação (ver `globals.css`).
 */
export function Segmentado<V extends string>({
  valor,
  aoMudar,
  opcoes,
  rotuloAcessivel,
  desabilitado,
  className,
  testid,
}: {
  valor: V;
  aoMudar: (valor: V) => void;
  opcoes: ReadonlyArray<OpcaoDoSegmentado<V>>;
  /** Nome do grupo para leitor de tela (ex.: "Papel do agente"). */
  rotuloAcessivel: string;
  desabilitado?: boolean;
  className?: string;
  testid?: string;
}) {
  const botoes = useRef<Array<HTMLButtonElement | null>>([]);

  const mover = (e: KeyboardEvent<HTMLButtonElement>, indice: number) => {
    const passo = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (passo === 0) return;
    e.preventDefault();
    const proximo = (indice + passo + opcoes.length) % opcoes.length;
    aoMudar(opcoes[proximo]!.valor);
    botoes.current[proximo]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={rotuloAcessivel}
      className={cn("ios-segmentado max-w-full overflow-x-auto", className)}
      data-testid={testid}
    >
      {opcoes.map((o, i) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              botoes.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={ativo}
            tabIndex={ativo ? 0 : -1}
            disabled={desabilitado}
            data-testid={o.testid}
            data-state={ativo ? "active" : "inactive"}
            onClick={() => aoMudar(o.valor)}
            onKeyDown={(e) => mover(e, i)}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-50",
              ativo ? "bg-surface text-text shadow-xs" : "text-muted-foreground hover:text-text",
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
