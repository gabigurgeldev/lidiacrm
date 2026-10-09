"use client";
/**
 * Índice das seções do editor de agente.
 *
 * O editor tinha treze cartões em duas colunas numa rolagem só, e quem queria
 * mexer no follow-up rolava a tela inteira procurando. Agora é uma coluna, e
 * este índice fica ao lado (fixo, em tela larga) levando direto à seção.
 */
export interface ItemDaNavegacao {
  id: string;
  rotulo: string;
}

export function NavegacaoDeSecoes({
  itens,
  rotuloAcessivel,
  aoEscolher,
}: {
  itens: ReadonlyArray<ItemDaNavegacao>;
  rotuloAcessivel: string;
  /** Avisado antes de rolar — a seção avançada precisa abrir para existir. */
  aoEscolher?: (id: string) => void;
}) {
  return (
    <nav aria-label={rotuloAcessivel} className="hidden lg:block" data-testid="editor-indice">
      <ul className="sticky top-4 space-y-0.5 text-sm">
        {itens.map((item) => (
          <li key={item.id}>
            <a
              href={`#secao-${item.id}`}
              onClick={(e) => {
                if (!aoEscolher) return;
                e.preventDefault();
                aoEscolher(item.id);
                // Depois do render que abre a seção, e não antes: rolar até um
                // elemento que ainda não existe não rola para lugar nenhum.
                requestAnimationFrame(() =>
                  document.getElementById(`secao-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
              className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-text"
            >
              {item.rotulo}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
