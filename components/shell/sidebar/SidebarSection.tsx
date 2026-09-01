"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { CaretRight } from "@/lib/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarSectionProps {
  id: string;
  label: string;
  icon: PhosphorIcon;
  aberto: boolean;
  compacto: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * `useLayoutEffect` roda no cliente e AVISA no servidor. A medida só existe
 * depois do layout, então não há versão de servidor para dar — e o CSS já cobre
 * esse instante com `height: var(--nav-altura, auto)`.
 */
const useLayoutEffectSeguro = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Um grupo do sidebar: cabeçalho clicável + corpo que recolhe.
 *
 * ⚠️ O CABEÇALHO É `<h2><button></h2>`, e as duas coisas importam.
 *
 * O `<button>` é o que o pedido descreve — área inteira clicável, `aria-expanded`,
 * chevron que gira. O `<h2>` por fora é o que mantém a barra navegável por
 * cabeçalho no leitor de tela, que é como se pula de seção em seção sem ouvir os
 * vinte links no caminho. Trocar um pelo outro perderia metade; aninhar custa
 * uma tag.
 *
 * ⚠️ A ALTURA É MEDIDA, e o corpo NÃO usa `grid-template-rows: 0fr → 1fr`.
 * O comentário de `.agenda-coluna-horarios` em `app/globals.css` registra a
 * medição que fecha o assunto: animar trilha de grid funciona no Chrome e falha
 * calado no Safari. Quem observa é a `<ul>` de dentro, nunca a caixa animada —
 * observar a caixa cuja altura nós mesmos escrevemos é um laço de realimentação.
 */
export function SidebarSection({
  id,
  label,
  icon: Icon,
  aberto,
  compacto,
  onToggle,
  children,
}: SidebarSectionProps) {
  const idCorpo = `nav-grupo-corpo-${id}`;
  const listaRef = useRef<HTMLDivElement | null>(null);
  const [altura, setAltura] = useState<number | null>(null);

  useLayoutEffectSeguro(() => {
    const el = listaRef.current;
    if (!el) return;
    const medir = () => setAltura(el.offsetHeight);
    medir();
    // A permissão pode encolher a lista, a saúde da conexão pode acrescentar um
    // ponto, e a fonte pode carregar depois — todas mudam a altura sem que este
    // componente renderize de novo.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cabecalho = (
    <button
      type="button"
      className="nav-secao-titulo"
      aria-expanded={aberto}
      aria-controls={idCorpo}
      aria-label={compacto ? label : undefined}
      data-nav-focavel=""
      data-nav-grupo={id}
      onClick={onToggle}
    >
      <Icon size={18} className="nav-icone shrink-0" aria-hidden />
      <span className="nav-rotulo truncate">{label}</span>
      <CaretRight size={14} className="nav-chevron shrink-0" aria-hidden />
    </button>
  );

  return (
    <div className="space-y-0.5">
      <h2 className="m-0">
        {compacto ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>{cabecalho}</TooltipTrigger>
            <TooltipContent side="right" className="nav-popover">
              {label}
            </TooltipContent>
          </Tooltip>
        ) : (
          cabecalho
        )}
      </h2>
      <div
        id={idCorpo}
        className="nav-grupo-corpo"
        data-aberto={aberto ? "true" : "false"}
        // ⚠️ `altura ?` e não `altura !== null ?` — ZERO É DESCARTADO DE
        // PROPÓSITO, e a diferença apareceu numa medição.
        //
        // A medida só existe depois do layout. Onde o layout ainda não
        // aconteceu — o componente montado dentro de um ancestral
        // `display: none` (é o caso da barra no celular, que a casca esconde
        // com `hidden md:block`), ou um render de teste sem CSS — `offsetHeight`
        // devolve 0. Gravar esse 0 na variável PRENDE o grupo aberto em altura
        // zero: ele fica aberto, com o chevron virado, e vazio.
        //
        // Sem a variável, o CSS usa `var(--nav-altura, auto)` e o grupo aberto
        // mostra o que tem. A altura exata só é necessária para ANIMAR, e animar
        // é o que menos importa quando a alternativa é não mostrar nada.
        style={altura ? ({ "--nav-altura": `${altura}px` } as React.CSSProperties) : undefined}
      >
        <div ref={listaRef}>{children}</div>
      </div>
    </div>
  );
}
