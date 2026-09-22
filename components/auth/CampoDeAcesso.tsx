"use client";

import * as React from "react";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/**
 * O campo das telas de acesso: rótulo flutuante, e o olho de revelar senha.
 *
 * ═══ Por que um componente, e não a mesma marcação copiada nos dois forms ═══
 *
 * Login tem 2 campos e cadastro tem 4, com recuperação e redefinição atrás.
 * Copiar a marcação seria garantir que uma delas ficasse para trás na primeira
 * vez que alguém mexesse — e a que fica para trás é sempre a que ninguém abre,
 * que é justamente onde o cliente do revendedor aparece sozinho.
 *
 * ═══ `placeholder=" "` não é resíduo ═══
 *
 * É um espaço, e é o que faz `:placeholder-shown` significar "campo vazio" no
 * CSS. Sem ele o rótulo nunca sobe e fica por cima do texto digitado. A regra
 * inteira do rótulo vive em `.acesso-campo` no `globals.css`, sem um byte de
 * JavaScript — nada aqui escuta `onChange` para mover rótulo.
 *
 * ═══ O olho ═══
 *
 * Erro de digitação em senha que não se pode conferir é a causa número um de
 * "não consigo entrar" — e nesta instalação o custo dele é alto, porque errar
 * várias vezes esbarra no limite de tentativas e a pessoa fica de fora por
 * minutos. O botão é `tabIndex={-1}` de propósito: ele fica ENTRE o campo de
 * senha e o de confirmação na ordem visual, e entrar no Tab ali interromperia
 * quem preenche o formulário inteiro pelo teclado.
 */
interface CampoDeAcessoProps extends Omit<React.ComponentProps<"input">, "placeholder"> {
  id: string;
  rotulo: string;
  erro?: string;
  /** Mostra o botão de revelar. Só faz sentido em campo de senha. */
  revelavel?: boolean;
  /** Renderizado sob o campo — o medidor de força entra por aqui. */
  acessorio?: React.ReactNode;
  /**
   * Ícone à esquerda. Decorativo — o rótulo é que nomeia o campo, e um ícone
   * anunciado por leitor de tela repetiria o nome com outra palavra.
   *
   * Ele gira em perspectiva quando o campo ganha foco (`.acesso-icone`, no
   * globals.css). É transform 3D em CSS, e não um `<canvas>` por campo: cada
   * contexto WebGL conta contra o teto de ~16 por aba, e gastar um deles num
   * envelope de 18px seria pagar caro pelo lugar errado — o vidro de verdade
   * está na cena atrás.
   */
  icone?: React.ReactNode;
}

export const CampoDeAcesso = React.forwardRef<HTMLInputElement, CampoDeAcessoProps>(
  ({ id, rotulo, erro, revelavel, acessorio, icone, className, type = "text", ...props }, ref) => {
    const [revelada, setRevelada] = React.useState(false);
    const tipoEmVigor = revelavel && revelada ? "text" : type;
    const idDoErro = `${id}-erro`;

    return (
      <div className="space-y-1.5">
        <div className="acesso-campo" data-com-icone={icone ? "sim" : undefined}>
          <input
            {...props}
            id={id}
            ref={ref}
            type={tipoEmVigor}
            placeholder=" "
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? idDoErro : undefined}
            className={cn(
              "peer h-[3.75rem] w-full rounded-[14px] border border-border bg-surface",
              // O texto começa abaixo do meio para abrir espaço ao rótulo
              // flutuado; `pr-12` reserva a coluna do olho e `pl-12` a do ícone.
              "px-4 pb-2 pt-7 text-[15px] font-medium text-text",
              icone && "pl-12",
              revelavel && "pr-12",
              "transition-[border-color,box-shadow,background-color] duration-fast ease-out",
              "hover:border-border-strong",
              "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
              "disabled:cursor-not-allowed disabled:opacity-55",
              "read-only:bg-surface-elevated read-only:text-text-muted",
              "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error-bg",
              className,
            )}
          />
          {/* Depois do input no DOM: o seletor do rótulo é `input ~ label`. */}
          <label htmlFor={id}>{rotulo}</label>
          {icone && (
            <span
              aria-hidden
              className="acesso-icone pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-subtle"
            >
              {icone}
            </span>
          )}
          {revelavel && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setRevelada((v) => !v)}
              aria-label={revelada ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={revelada}
              className={cn(
                "absolute right-1 top-1/2 -translate-y-1/2 rounded-[8px] p-2.5",
                "text-text-muted transition-colors duration-fast ease-out",
                "hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
              )}
            >
              {revelada ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          )}
        </div>
        {acessorio}
        {erro && (
          <p id={idDoErro} role="alert" className="acesso-erro text-xs text-error">
            {erro}
          </p>
        )}
      </div>
    );
  },
);
CampoDeAcesso.displayName = "CampoDeAcesso";

/**
 * O medidor de força da senha.
 *
 * ⚠️ Ele DESCREVE, não decide. A regra que barra o cadastro é o
 * `min(8)` de `lib/auth/schemas.ts`, e é ela que reprova o envio. Este medidor
 * existe para dar retorno enquanto se digita — prometer mais do que o servidor
 * exige seria inventar uma política de senha que nenhuma camada aplica.
 *
 * `aria-hidden` porque quem usa leitor de tela já recebe a mensagem de erro do
 * campo; narrar "força 2 de 4" a cada tecla seria ruído sobre a informação boa.
 */
export function ForcaDaSenha({ senha }: { senha: string }) {
  const nivel = medirForca(senha);
  const rotulos = ["", "fraca", "razoável", "boa", "forte"] as const;

  return (
    <div aria-hidden className="flex items-center gap-2 pt-0.5">
      <div className="acesso-forca flex-1">
        <span style={{ width: `${(nivel / 4) * 100}%` }} />
      </div>
      <span className="w-14 text-right text-[11px] text-text-subtle">{rotulos[nivel]}</span>
    </div>
  );
}

/** 0 a 4. Comprimento manda; variedade de caractere complementa. */
function medirForca(senha: string): number {
  if (senha.length === 0) return 0;
  let pontos = 0;
  if (senha.length >= 8) pontos += 1;
  if (senha.length >= 12) pontos += 1;
  if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos += 1;
  if (/\d/.test(senha) || /[^\w\s]/.test(senha)) pontos += 1;
  return Math.min(pontos, 4);
}
