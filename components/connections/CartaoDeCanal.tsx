"use client";

import type { ReactNode } from "react";

import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import { Badge } from "@/components/ui/badge";
import { WhatsappLogo } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * O CARTÃO DE UM CANAL — o mesmo para todas as formas de conectar.
 *
 * ─── Por que um componente, e não três cartões parecidos ────────────────────
 *
 * Antes desta extração cada aba de Conexões desenhava o seu: o número por QR
 * tinha `Phone` + badge; o canal oficial eram três `Card` empilhados sem ícone
 * nenhum; o intermediado, um quarto arranjo. O operador precisava reaprender a
 * ler a tela a cada aba, e nenhum dos três dizia POR ONDE aquele número fala —
 * a informação que decide se cabe texto livre ou só modelo aprovado.
 *
 * Com um cartão só, a próxima integração herda a leitura em vez de inventar a
 * quinta variação. É o mesmo motivo pelo qual o selo de tipo é um componente e
 * não um `<span>` copiado.
 *
 * ─── O disco verde ─────────────────────────────────────────────────────────
 *
 * O verde do disco é a marca do WhatsApp, não o accent do produto — e é por isso
 * que ele lê `--color-success-*` via `.ios-disco` em vez de `accent`. Um cartão
 * pintado com o accent diria "isto é destaque do sistema"; o que ele precisa
 * dizer é "isto é um número de WhatsApp".
 */
export function CartaoDeCanal({
  nome,
  telefone,
  provider,
  modo,
  estado,
  detalhe,
  acoes,
  aviso,
  className,
}: {
  nome: string;
  /** Em `font-mono`, e só quando difere do nome — senão a linha repete a si mesma. */
  telefone?: string | null;
  provider?: string | null;
  modo?: string | null;
  estado?: { rotulo: string; tom: "success" | "warning" | "error" | "neutral" } | null;
  /** Linha pequena sob o cabeçalho: última verificação, WABA, o que couber. */
  detalhe?: ReactNode;
  /** Botões do rodapé. Sem eles o rodapé não é desenhado — cartão só de leitura. */
  acoes?: ReactNode;
  /** Faixa de atenção DENTRO do cartão, para o que é daquele canal e de mais nada. */
  aviso?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("ios-grupo flex flex-col", className)}
      data-testid="cartao-de-canal"
      data-provider-conhecido={provider ? "sim" : "nao"}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="ios-disco" aria-hidden>
          <WhatsappLogo size={22} weight="fill" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium text-text">{nome}</p>
            {estado && (
              <Badge variant={estado.tom} className="shrink-0">
                {estado.rotulo}
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {telefone && telefone !== nome && (
              <span className="font-mono text-xs text-text-muted">{telefone}</span>
            )}
            {/* `cartao` é a variante larga: aqui cabe o nome do intermediário, e é
                justamente onde o operador decide a quem pedir suporte quando o
                número cai. No selo estreito da lista ele não caberia. */}
            <TipoDeCanal provider={provider} modo={modo} variante="cartao" />
          </div>

          {detalhe && <div className="mt-2 text-[11px] text-text-muted">{detalhe}</div>}
        </div>
      </div>

      {aviso}

      {acoes && <div className="flex flex-wrap gap-2 p-3">{acoes}</div>}
    </div>
  );
}
