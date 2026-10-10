/**
 * Peças pequenas que as seções do editor de agente dividem.
 *
 * O kit de Ajustes (`components/ajustes`) dá o cartão e a linha; o que falta
 * para um formulário — o erro embaixo do campo e o miolo com respiro para um
 * seletor que já traz o próprio rótulo — mora aqui, uma vez.
 */
import type { ReactNode } from "react";

/** Erro de validação embaixo do campo. */
export function ErroDoCampo({ texto }: { texto: string | undefined }) {
  if (!texto) return null;
  return <p className="text-xs text-destructive">{texto}</p>;
}

/**
 * Miolo de largura inteira dentro de um `Grupo`, para os seletores que já
 * trazem o próprio rótulo (`ModelPicker`, `CredentialPicker`, `TriggerEditor`…).
 * Embrulhá-los num `Campo` daria dois rótulos para o mesmo controle.
 */
export function Bloco({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <div className="space-y-2 px-4 py-3" data-testid={testid}>
      {children}
    </div>
  );
}

/**
 * Âncora de uma seção. O `scroll-mt` deixa o título visível quando a navegação
 * de seções rola até ela — sem ele, o título para embaixo do cabeçalho do app.
 */
export function AncoraDaSecao({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={`secao-${id}`} className="scroll-mt-24 space-y-3">
      {children}
    </div>
  );
}
