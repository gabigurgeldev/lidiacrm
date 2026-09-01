"use client";

/**
 * As peças de tela do painel "Criar fluxo com IA".
 *
 * A versão anterior era `<p>` cru com botões `outline` soltos: sem hierarquia,
 * sem estado de espera decente ("Pensando…" em texto), sem transição nenhuma.
 * Funcionava e parecia inacabado — e este painel é a primeira vez que alguém vê
 * a IA do produto trabalhando.
 *
 * ═══ Sem dependência nova ═══
 *
 * Toda animação é `tailwindcss-animate` (`animate-in`, `fade-in`, `zoom-in-95`,
 * `slide-in-from-*`), que o repo já usa em `NoDoFluxo.tsx` e nos overlays do
 * shadcn. `framer-motion` NÃO existe aqui e não entra: peso de runtime novo
 * para um painel é o tipo de custo que um self-hoster paga em disco e memória
 * sem nunca ter pedido.
 */
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Check, Sparkle } from "@/lib/ui/icons";

// ─────────────────────────────── trilho de passos ────────────────────────────

export type PassoDoTrilho = "descrever" | "esclarecer" | "planejar" | "montar";

const ORDEM: PassoDoTrilho[] = ["descrever", "esclarecer", "planejar", "montar"];

/**
 * O trilho de progresso.
 *
 * Reusa a LINGUAGEM VISUAL do `app/onboarding/_components/Stepper.tsx` (bolinha
 * numerada, preenchida no passo atual, marcada nos cumpridos) sem reusar o
 * componente: aquele deriva o passo de `usePathname()`, e aqui não há uma rota
 * por passo — o painel inteiro vive numa tela só, de propósito.
 */
export function PassosDaGeracao({
  atual,
  rotulos,
}: {
  atual: PassoDoTrilho;
  rotulos: Record<PassoDoTrilho, string>;
}) {
  const indiceAtual = ORDEM.indexOf(atual);
  return (
    <ol className="flex items-center gap-1" data-testid="ia-passos">
      {ORDEM.map((passo, i) => {
        const cumprido = i < indiceAtual;
        const ativo = i === indiceAtual;
        return (
          <li key={passo} className="flex flex-1 items-center gap-1">
            <span
              aria-current={ativo ? "step" : undefined}
              data-estado={cumprido ? "cumprido" : ativo ? "ativo" : "pendente"}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium transition-colors",
                cumprido && "border-primary bg-primary text-primary-foreground",
                ativo && "border-primary text-primary",
                !cumprido && !ativo && "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {cumprido ? <Check className="size-3" weight="bold" /> : i + 1}
            </span>
            <span
              className={cn(
                "truncate text-[11px]",
                ativo ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {rotulos[passo]}
            </span>
            {i < ORDEM.length - 1 && (
              <span
                className={cn("h-px flex-1", cumprido ? "bg-primary" : "bg-border")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ──────────────────────────────────── chat ───────────────────────────────────

export function Bolha({ papel, children }: { papel: "usuario" | "ia"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex animate-in fade-in slide-in-from-bottom-2 duration-300",
        papel === "usuario" ? "justify-end" : "justify-start",
      )}
    >
      <p
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          papel === "usuario"
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * O estado de espera.
 *
 * Três blocos em forma de bolha, no lugar do `<p>Pensando…</p>` de antes. A
 * diferença não é enfeite: uma frase estática não distingue "está pensando" de
 * "travou", e essa dúvida é exatamente a que o painel produzia.
 */
export function Pensando({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-label={rotulo} data-testid="ia-pensando">
      <Skeleton className="h-8 w-3/5 rounded-2xl rounded-bl-sm" />
      <Skeleton className="h-8 w-4/5 rounded-2xl rounded-bl-sm" />
      <Skeleton className="h-8 w-2/5 rounded-2xl rounded-bl-sm" />
    </div>
  );
}

// ──────────────────────────────── opções ─────────────────────────────────────

/**
 * Uma opção de resposta, como CARTÃO clicável.
 *
 * `role="radio"` e navegação por seta porque é uma escolha única entre poucas —
 * um punhado de `<Button>` soltos não diz isso a quem usa leitor de tela, e a
 * versão anterior era exatamente isso.
 */
export function CartaoDeOpcao({
  texto,
  indice,
  selecionado,
  desabilitado,
  aoEscolher,
  aoNavegar,
}: {
  texto: string;
  indice: number;
  selecionado: boolean;
  desabilitado: boolean;
  aoEscolher: () => void;
  aoNavegar: (delta: number) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selecionado}
      disabled={desabilitado}
      data-testid="ia-opcao"
      onClick={aoEscolher}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          aoNavegar(1);
        }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          aoNavegar(-1);
        }
      }}
      // O atraso escalonado faz as opções entrarem em cascata em vez de piscarem
      // juntas — é o que dá a sensação de resposta chegando, e custa uma linha.
      style={{ animationDelay: `${Math.min(indice, 5) * 60}ms` }}
      className={cn(
        "group flex w-full animate-in fade-in zoom-in-95 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm duration-300 fill-mode-backwards",
        "hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selecionado && "border-primary bg-accent",
      )}
    >
      <span>{texto}</span>
      <Check
        className={cn(
          "size-4 shrink-0 text-primary transition-opacity",
          selecionado ? "opacity-100" : "opacity-0 group-hover:opacity-40",
        )}
      />
    </button>
  );
}

// ───────────────────────────── progresso da montagem ─────────────────────────

export function ProgressoDaMontagem({
  concluidos,
  total,
  rotulo,
}: {
  concluidos: number;
  total: number;
  rotulo: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((concluidos / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2" data-testid="ia-progresso">
      <div className="flex items-center gap-2 text-sm">
        <Sparkle className="size-4 shrink-0 animate-pulse text-primary" />
        <span className="text-muted-foreground">{rotulo}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
