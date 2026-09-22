"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SidebarItemProps {
  href: string;
  label: string;
  icon: PhosphorIcon;
  ativo: boolean;
  /** Barra estreita: o rótulo some por CSS e o nome passa a viver no tooltip. */
  compacto: boolean;
  onNavigate?: () => void;
  /** Sinal do próprio destino (hoje: a saúde das conexões). */
  extra?: ReactNode;
}

/**
 * Um destino do sidebar.
 *
 * ⚠️ O PESO DO ÍCONE É O MESMO EM TODOS OS ITENS, inclusive no ativo.
 *
 * A regra é essa, e o peso escolhido é `duotone`. Uma versão antiga trocava
 * para `fill` quando o item estava aceso, e o efeito colateral era um menu com
 * dois desenhos diferentes na mesma coluna: um ícone sólido no meio de doze
 * contornos. Quem carrega o estado ativo é a cor (`.nav-item[data-ativo]
 * .nav-icone` na accent), o fundo a 12% e a marca de 3px na borda — três
 * sinais, nenhum deles trocando a linguagem do ícone.
 *
 * ⚠️ ERA `regular` (peso implícito). Virou `duotone` para a casca falar a mesma
 * língua das telas de acesso, onde envelope e cadeado são duotone
 * (`components/auth/LoginForm.tsx:71,81`) — e porque duotone é o default
 * declarado na doutrina (`docs/design-system/09-anti-patterns.md:64-67`), que a
 * casca era o último lugar a não seguir. A regra que o comentário antigo
 * defendia (não misturar pesos na mesma coluna) segue intacta: o que mudou foi
 * a constante, não o princípio.
 *
 * `size={20}` e não 18: 18 não existe na tabela de
 * `docs/design-system/05-iconography-phosphor.md:29-40` ("não invente
 * intermediários"), e 20 é o mesmo tamanho dos ícones dos campos de acesso.
 *
 * `data-ativo` e não uma classe condicional: a folha de estilo precisa alcançar
 * `::before` (a marca lateral), e pseudo-elemento não existe no JSX.
 */
export function SidebarItem({
  href,
  label,
  icon: Icon,
  ativo,
  compacto,
  onNavigate,
  extra,
}: SidebarItemProps) {
  const link = (
    <Link
      href={href}
      className="nav-item"
      data-ativo={ativo ? "true" : undefined}
      data-nav-focavel=""
      aria-current={ativo ? "page" : undefined}
      // O nome acessível não pode depender de CSS: estreita, a barra esconde o
      // `<span>` com `display: none`, e sem isto o link ficaria sem nome nenhum
      // para quem usa leitor de tela.
      aria-label={compacto ? label : undefined}
      onClick={onNavigate}
    >
      <Icon size={20} weight="duotone" className="nav-icone shrink-0" aria-hidden />
      <span className="nav-rotulo truncate">{label}</span>
      {extra}
    </Link>
  );

  if (!compacto) return link;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className={cn("nav-popover")}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
