/**
 * KIT DE AJUSTES — a linguagem Gestalt ("Ajustes do iOS") em componentes.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * A linguagem foi adotada em 2026-09-01 (`app/globals.css`, bloco "CARTÃO
 * AGRUPADO E SEGMENTADO"), mas só como classes CSS: `.ios-grupo`, `.ios-linha`,
 * `.ios-segmentado`, `.ios-disco`. Cada tela que a usou montou o próprio
 * arranjo — Conexões, o painel de blocos dos fluxos, o pareamento —, e as 17
 * telas da Central de IA não usavam nenhum. Sem componente, a sexta tela
 * inventa a sexta variação de "título do grupo" e o produto deixa de parecer um.
 *
 * ─── As peças ───────────────────────────────────────────────────────────────
 *
 * - `PaginaAjustes` — cabeçalho da página (título, descrição, ações) e o
 *   espaçamento entre os grupos.
 * - `Grupo` — UM cartão agrupado. Título e rodapé ficam FORA do cartão (dentro,
 *   viravam a primeira linha, com divisor embaixo).
 * - `Linha` — rótulo à esquerda, valor ou controle à direita. Com `href` ou
 *   `aoClicar`, vira navegação, com seta.
 * - `Campo` / `Dica` / `Aviso` — formulário dentro do grupo: rótulo em cima,
 *   controle de largura inteira (a `.ios-linha` espremeria o campo de texto).
 * - `LinhaInterruptor` e `Segmentado` — em `controles.tsx` (são de cliente).
 *
 * Nada aqui traduz: quem chama passa o texto já pelo `t()` / `traduzir()`.
 * Assim o kit serve tanto em página de servidor quanto em componente de cliente.
 *
 * ─── O que NÃO usar aqui ─────────────────────────────────────────────────────
 *
 * Vidro (`.ios-vidro`) não entra em nenhuma peça: é de chassi (barra flutuante,
 * cartão de topo), e um grupo que se repete por linha de lista o multiplicaria.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { CaretRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export function PaginaAjustes({
  titulo,
  descricao,
  acoes,
  children,
  className,
  testid,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  /** Botões do cabeçalho (ex.: "Novo agente"). Ficam à direita; descem em tela estreita. */
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
  testid?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col gap-6 p-4 sm:p-6", className)} data-testid={testid}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          {descricao !== undefined && <p className="max-w-prose text-sm text-muted-foreground">{descricao}</p>}
        </div>
        {acoes !== undefined && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </header>
      {children}
    </div>
  );
}

export function Grupo({
  titulo,
  rodape,
  recuo,
  children,
  className,
  testid,
}: {
  titulo?: ReactNode;
  /** Explicação curta embaixo do cartão, como no iOS. */
  rodape?: ReactNode;
  /** `icone`: o divisor começa onde o texto começa, depois do ícone da linha. */
  recuo?: "icone";
  children: ReactNode;
  className?: string;
  testid?: string;
}) {
  return (
    <section className={cn("space-y-1.5", className)}>
      {titulo !== undefined && (
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      )}
      <div className="ios-grupo" data-recuo={recuo} data-testid={testid}>
        {children}
      </div>
      {rodape !== undefined && <p className="px-1 text-xs leading-snug text-muted-foreground">{rodape}</p>}
    </section>
  );
}

type PropsDaLinha = {
  /** Ícone à esquerda; com `disco`, num círculo (o `.ios-disco`). */
  icone?: ReactNode;
  disco?: boolean;
  titulo: ReactNode;
  descricao?: ReactNode;
  /** Texto à direita, discreto (ex.: "Ligado", "3 agentes"). */
  valor?: ReactNode;
  /** Controle à direita (interruptor, botão, pílula de estado). */
  controle?: ReactNode;
  testid?: string;
  className?: string;
} & ({ href: string; aoClicar?: never } | { aoClicar: () => void; href?: never } | { href?: never; aoClicar?: never });

export function Linha(props: PropsDaLinha) {
  const { icone, disco, titulo, descricao, valor, controle, testid, className } = props;
  const navega = props.href !== undefined || props.aoClicar !== undefined;
  const miolo = (
    <>
      {icone !== undefined && (
        <span className={cn("flex-none", disco ? "ios-disco" : "text-muted-foreground")} aria-hidden>
          {icone}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">{titulo}</span>
        {descricao !== undefined && (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{descricao}</span>
        )}
      </span>
      {valor !== undefined && <span className="flex-none text-sm text-muted-foreground">{valor}</span>}
      {controle !== undefined && <span className="flex-none">{controle}</span>}
      {navega && <CaretRight size={14} className="flex-none text-muted-foreground" aria-hidden />}
    </>
  );

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={cn("ios-linha", className)} data-clicavel="sim" data-testid={testid}>
        {miolo}
      </Link>
    );
  }
  if (props.aoClicar !== undefined) {
    return (
      <button
        type="button"
        onClick={props.aoClicar}
        className={cn("ios-linha w-full text-left", className)}
        data-clicavel="sim"
        data-testid={testid}
      >
        {miolo}
      </button>
    );
  }
  return (
    <div className={cn("ios-linha", className)} data-testid={testid}>
      {miolo}
    </div>
  );
}

/** Uma linha de formulário: rótulo em cima, controle de largura inteira embaixo. */
export function Campo({
  rotulo,
  htmlFor,
  children,
}: {
  rotulo: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 px-4 py-3">
      <Label htmlFor={htmlFor}>{rotulo}</Label>
      {children}
    </div>
  );
}

/** Explicação de um campo. Mora DENTRO do `Campo`, embaixo do controle. */
export function Dica({ texto }: { texto: ReactNode }) {
  return <p className="text-xs leading-snug text-muted-foreground">{texto}</p>;
}

/** Um cartão só de texto — o que não tem o que ajustar explica o que faz, em vez de nada. */
export function Aviso({ texto }: { texto: ReactNode }) {
  return <p className="ios-grupo px-4 py-3 text-xs leading-snug text-muted-foreground">{texto}</p>;
}

/**
 * O `Secao` dos formulários de bloco dos fluxos — um `Grupo` sem rodapé.
 * Mantido com o nome antigo porque dezesseis formulários o importam.
 */
export function Secao({ titulo, children, testid }: { titulo?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <Grupo titulo={titulo} testid={testid}>
      {children}
    </Grupo>
  );
}
