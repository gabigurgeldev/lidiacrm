"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useBuscaGlobal, useTermoAtrasado } from "@/hooks/search/useBuscaGlobal";
import { ChatCircle, Kanban, MagnifyingGlass, Users } from "@/lib/ui/icons";
import { NAV_GROUPS, searchable, type NavDestination } from "@/lib/navigation/registry";
import { BUSCA_MIN, type SearchKind, type SearchResult } from "@/lib/schemas/search";
import { cn } from "@/lib/utils";

/**
 * Paleta de busca (⌘K).
 *
 * Sem `cmdk`: o projeto já tem Dialog e Input, e uma lista filtrada com setas e
 * Enter são poucas linhas. Uma dependência a mais para isso seria peso sem ganho.
 *
 * ── Duas fontes, uma lista ───────────────────────────────────────────────────
 *
 * ⚠️ A v1 buscava SÓ NAVEGAÇÃO, e o comentário aqui dizia que contato, conversa
 * e lead eram "outra feature". Eram — e esta é ela. O que mudou:
 *
 *  - as PÁGINAS continuam vindo do registro, em memória, e aparecem no mesmo
 *    caractere em que são digitadas. Elas nunca dependem da rede;
 *  - os REGISTROS vêm de `GET /api/v1/search`, com 250ms de espera e a partir
 *    de dois caracteres.
 *
 * As duas viram UMA lista plana (`linhas`), e é sobre ela que as setas e o Enter
 * andam. Guardar dois índices — um por fonte — é o caminho curto para o Enter
 * abrir a linha errada assim que a resposta do servidor chega e reordena o que
 * está abaixo do cursor.
 *
 * ── O que a busca NÃO alcança ────────────────────────────────────────────────
 *
 * O conteúdo das mensagens. O motivo (um índice trigram na tabela mais escrita
 * do produto) está no cabeçalho de `app/api/v1/search/_handler.ts`. A conversa
 * é achada pelo nome do contato dela.
 */

/** Sem acento e sem caixa: ninguém digita "orçamento" com cedilha às pressas. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const ROTULO_GRUPO = new Map(NAV_GROUPS.map((g) => [g.id, g.label]));

/**
 * Uma linha da paleta, venha ela do registro ou do banco.
 *
 * O tipo é UM porque a navegação por teclado é uma só. Dois tipos obrigariam
 * cada tecla a perguntar "de qual lista é este índice?", que é exatamente onde
 * o Enter erra de alvo.
 */
type Linha = {
  readonly chave: string;
  /** Rótulo da seção a que a linha pertence, já traduzido. */
  readonly secao: string;
  readonly titulo: string;
  readonly sub: string | null;
  /** Etiqueta curta à direita do título — o grupo do menu, nas páginas. */
  readonly etiqueta: string | null;
  readonly icone: PhosphorIcon;
  readonly href: string;
};

/** O ícone de cada tipo de registro. Um por seção, para a lista se ler de relance. */
const ICONE_POR_TIPO: Record<SearchKind, PhosphorIcon> = {
  contact: Users,
  conversation: ChatCircle,
  lead: Kanban,
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 p-0">
        <DialogTitle className="sr-only">{t("Buscar telas")}</DialogTitle>
        {/* O miolo é um componente à parte porque o Radix o DESMONTA ao fechar:
            busca e destaque nascem zerados na próxima abertura por construção,
            sem um efeito de reset para manter em sincronia. */}
        <Resultados aoEscolher={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Resultados({ aoEscolher }: { aoEscolher: () => void }) {
  const t = useT();
  const router = useRouter();
  const { user, activeOrg } = useAuth();
  const [busca, setBusca] = useState("");
  const [destacado, setDestacado] = useState(0);

  const termoAtrasado = useTermoAtrasado(busca);
  const { data: remoto, isFetching } = useBuscaGlobal(termoAtrasado);

  const visiveis = useMemo(
    () => searchable(user.is_platform_admin, activeOrg?.role ?? null),
    [user.is_platform_admin, activeOrg?.role],
  );

  const paginas = useMemo(() => {
    const termo = normalizar(busca.trim());
    // Sem termo, abre no trabalho do dia em vez de uma tela vazia que não
    // ensina nada sobre o que dá para procurar aqui.
    if (!termo) return visiveis.filter((d) => d.group === "atendimento");
    return visiveis.filter((d) => normalizar(`${d.label} ${d.description}`).includes(termo));
  }, [busca, visiveis]);

  const linhas = useMemo<Linha[]>(() => {
    const daNavegacao: Linha[] = paginas.map((d: NavDestination) => ({
      chave: `nav:${d.href}`,
      secao: t("Páginas"),
      titulo: t(d.label),
      sub: t(d.description),
      etiqueta: t(ROTULO_GRUPO.get(d.group) ?? ""),
      icone: d.icon,
      href: d.href,
    }));

    // ⚠️ A ORDEM DAS SEÇÕES É FIXA, e não a que o servidor devolveu. A resposta
    // vem numa lista só e a ordem dentro dela depende de qual consulta terminou
    // primeiro — deixá-la mandar faria as seções trocarem de lugar entre duas
    // digitações, embaixo do cursor de quem está usando as setas.
    const ordem: SearchKind[] = ["contact", "conversation", "lead"];
    const rotulo: Record<SearchKind, string> = {
      contact: t("Contatos"),
      conversation: t("Conversas"),
      lead: t("Leads"),
    };
    const doBanco: Linha[] = ordem.flatMap((tipo) =>
      (remoto?.results ?? [])
        .filter((r: SearchResult) => r.kind === tipo)
        .map((r) => ({
          chave: `${r.kind}:${r.id}`,
          secao: rotulo[tipo],
          titulo: r.title,
          sub: r.subtitle,
          etiqueta: null,
          icone: ICONE_POR_TIPO[tipo],
          href: r.href,
        })),
    );

    // Páginas primeiro: elas chegam sem rede e são o destino mais frequente de
    // quem abre a paleta. Pôr o resultado do banco por cima faria o primeiro
    // item saltar quando a resposta chegasse — e o Enter apressado abriria
    // outra coisa.
    return [...daNavegacao, ...doBanco];
  }, [paginas, remoto, t]);

  function navegar(linha: Linha) {
    aoEscolher();
    router.push(linha.href);
  }

  /**
   * O destaque volta ao topo junto com a busca, no mesmo evento: mantê-lo
   * apontaria para outro item depois que a lista muda, e o Enter navegaria
   * para o lugar errado.
   */
  function aoDigitar(valor: string) {
    setBusca(valor);
    setDestacado(0);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDestacado((i) => Math.min(i + 1, linhas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDestacado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = linhas[destacado];
      if (alvo) navegar(alvo);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4">
        <MagnifyingGlass size={16} aria-hidden className="shrink-0 text-muted-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="palette-resultados"
          aria-activedescendant={linhas[destacado] ? `palette-${destacado}` : undefined}
          value={busca}
          onChange={(e) => aoDigitar(e.target.value)}
          onKeyDown={aoTeclar}
          placeholder={t("Buscar páginas, contatos, conversas…")}
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {/* O estado de "procurando" fica NO CAMPO, não no lugar da lista: as
            páginas já estão na tela e substituí-las por um esqueleto tiraria de
            baixo do cursor o que a pessoa já podia escolher. */}
        {isFetching && (
          <span className="shrink-0 text-[11px] text-muted-foreground" role="status">
            {t("Procurando…")}
          </span>
        )}
      </div>

      {linhas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {busca.trim().length < BUSCA_MIN
            ? t("Digite ao menos duas letras para buscar contatos, conversas e leads.")
            : `${t("Nada encontrado para")} “${busca}”.`}
        </p>
      ) : (
        <ul
          id="palette-resultados"
          role="listbox"
          aria-label={t("Resultados")}
          className="max-h-80 overflow-y-auto p-2"
        >
          {linhas.map((linha, i) => {
            const Icon = linha.icone;
            const ativo = i === destacado;
            // O cabeçalho de seção nasce na TROCA de seção, dentro do mesmo
            // laço: uma lista por seção quebraria a numeração contínua de que
            // as setas dependem.
            const abreSecao = i === 0 || linhas[i - 1]?.secao !== linha.secao;
            return (
              <li key={linha.chave} className="contents">
                {abreSecao && (
                  <div
                    role="presentation"
                    className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-1"
                  >
                    {linha.secao}
                  </div>
                )}
                <div
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={ativo}
                  data-href={linha.href}
                  onMouseEnter={() => setDestacado(i)}
                  onClick={() => navegar(linha)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2",
                    ativo && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon
                    size={20}
                    weight="duotone"
                    aria-hidden
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{linha.titulo}</span>
                      {linha.etiqueta && (
                        <span className="truncate text-[11px] uppercase tracking-wider text-muted-foreground/70">
                          {linha.etiqueta}
                        </span>
                      )}
                    </div>
                    {linha.sub && (
                      <p className="truncate text-xs text-muted-foreground">{linha.sub}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
