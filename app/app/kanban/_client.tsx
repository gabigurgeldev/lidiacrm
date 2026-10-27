"use client";
import { useState } from "react";
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import { EmptyPipeline } from "@/components/empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/types";
import { formatarReais } from "@/lib/kanban/dinheiro";
import { MODELOS_DE_KANBAN } from "@/lib/pipelines/pipeline-editing";
import { cn } from "@/lib/utils";
import {
  Archive,
  CaretDown,
  CaretUp,
  Check,
  Kanban,
  PencilSimple,
  Plus,
  Star,
} from "@/lib/ui/icons";
import { useArquivarFunil, useCriarFunil, useEditarFunil } from "@/hooks/pipelines/usePipelines";

export interface FunilDaLista {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  is_default: boolean;
}

/** O retrato de um Kanban na lista: quantos negócios abertos, quanto valem, onde estão. */
export interface ResumoDoKanban {
  abertos: number;
  valorCents: number;
  colunas: Array<{ id: string; name: string; color: string | null; abertos: number }>;
}

/**
 * O vizinho DE CIMA depois de mover o funil uma casa (`null` = primeiro da lista).
 *
 * É o que o PATCH espera: quem clica na seta sabe onde o funil vai parar, não
 * qual fração de `position` isso vira. Subir uma casa é "passar a ficar depois de
 * quem estava DUAS casas acima" — daí o `i - 2`.
 */
export function vizinhoAoMover(
  funis: FunilDaLista[],
  i: number,
  direcao: "subir" | "descer",
): string | null {
  if (direcao === "subir") return funis[i - 2]?.id ?? null;
  return funis[i + 1]?.id ?? null;
}

/**
 * A mensagem que a rota escreveu, ou uma frase honesta quando não há nenhuma.
 *
 * ⚠️ NUNCA INVENTAR TEXTO NO LUGAR DA RECUSA. As mensagens de
 * `lib/pipelines/pipeline-editing.ts` são a única coisa que explica ao dono da
 * operação POR QUE o Kanban não pode ser arquivado (formulário apontando para
 * ele, automação ativa, Kanban padrão). Trocá-las por "erro ao arquivar"
 * transformaria uma instrução acionável em um beco sem saída.
 */
function textoDoErro(e: unknown, t: (texto: string) => string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return t("Não consegui completar essa ação. Tente de novo.");
}

/** Paleta de reserva para coluna sem cor — a barra do cartão não fica cinza chapada. */
const CORES_DE_RESERVA = ["#2563eb", "#0891b2", "#7c3aed", "#d97706", "#16a34a", "#db2777"];

/**
 * A lista de Kanbans — e onde eles nascem.
 *
 * Cada Kanban é um cartão que responde, antes de abrir: quantos negócios estão
 * andando, quanto valem e em que coluna se acumulam (a barra colorida no topo é
 * a distribuição real dos negócios abertos). As ações ficam à vista, como
 * ícones — esconder "Renomear" num menu faria o dono da operação caçar o que
 * já estava ali.
 *
 * ⚠️ OS TESTIDS SÃO CONTRATO DE `tests/e2e/pipelines-gestao.spec.ts`:
 * `li[data-testid="funil-{id}"]` com UM link só (o nome), "Padrão" dentro do
 * cartão, e os botões `subir-`, `descer-`, `renomear-`, `padrao-`, `arquivar-`
 * clicáveis direto (sem abrir menu).
 */
export function FunisClient({
  funis: funisDoServidor,
  resumo,
  podeGerenciar,
}: {
  funis: FunilDaLista[];
  resumo: Record<string, ResumoDoKanban>;
  /** Espelha o `requireRole("manager")` das rotas — ver o comentário da page. */
  podeGerenciar: boolean;
}) {
  const t = useT();
  /**
   * ⚠️ A LISTA VEM DO SERVIDOR E É ATUALIZADA PELO CORPO DA RESPOSTA.
   *
   * As rotas releem os Kanbans do banco antes de responder, então aplicar o corpo
   * é mostrar o que o banco tem — sem depender de o `router.refresh()` vencer a
   * corrida contra os prefetches RSC da barra lateral. O ajuste abaixo mantém as
   * props no comando quando é o SERVIDOR que traz novidade.
   */
  const [funis, setFunis] = useState<FunilDaLista[]>(funisDoServidor);
  const [ultimoDoServidor, setUltimoDoServidor] = useState<FunilDaLista[]>(funisDoServidor);
  if (funisDoServidor !== ultimoDoServidor) {
    setUltimoDoServidor(funisDoServidor);
    setFunis(funisDoServidor);
  }

  const criar = useCriarFunil();
  const editar = useEditarFunil();
  const arquivar = useArquivarFunil();

  const [novo, setNovo] = useState<{ nome: string; descricao: string; modelo: string } | null>(null);
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const [arquivando, setArquivando] = useState<{ id: string; erro: string | null } | null>(null);
  const [erro, setErro] = useState<{ id: string | null; texto: string } | null>(null);

  const ocupado = criar.isPending || editar.isPending || arquivar.isPending;

  function criarFunil() {
    if (!novo) return;
    const nome = novo.nome.trim();
    if (!nome || criar.isPending) return;
    setErro(null);
    criar.mutate(
      {
        name: nome,
        description: novo.descricao.trim() || null,
        ...(novo.modelo ? { modelo: novo.modelo } : {}),
      },
      {
        onSuccess: (r) => {
          setFunis(r.data.pipelines);
          setNovo(null);
        },
        onError: (e) => setErro({ id: null, texto: textoDoErro(e, t) }),
      },
    );
  }

  function aplicar(id: string, patch: Parameters<typeof editar.mutate>[0]["patch"]) {
    setErro(null);
    editar.mutate(
      { id, patch },
      {
        onSuccess: (r) => {
          setFunis(r.data.pipelines);
          setRenomeando(null);
        },
        onError: (e) => setErro({ id, texto: textoDoErro(e, t) }),
      },
    );
  }

  function pedirArquivamento(id: string, definitivo: boolean) {
    setErro(null);
    arquivar.mutate(
      { id, definitivo },
      {
        onSuccess: (r) => {
          setFunis(r.data.pipelines);
          setArquivando(null);
        },
        // A recusa fica NO CARTÃO, não numa faixa longe do botão: ela é a
        // resposta à pergunta que o usuário acabou de fazer.
        onError: (e) => setArquivando({ id, erro: textoDoErro(e, t) }),
      },
    );
  }

  const modeloEscolhido = MODELOS_DE_KANBAN.find((m) => m.id === novo?.modelo);
  const colunasDaPrevia = modeloEscolhido?.colunas ?? ["Novo", "Em andamento", "Ganho", "Perdido"];

  const formularioDeCriacao = novo !== null && (
    <section
      className="ios-grupo flex flex-col gap-5 p-5"
      data-testid="form-novo-funil"
      aria-label={t("Novo Kanban")}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          autoFocus
          value={novo.nome}
          onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") criarFunil();
            if (e.key === "Escape") setNovo(null);
          }}
          placeholder={t("Nome do Kanban — ex.: Consultas, Obras, Matrículas")}
          aria-label={t("Nome do novo Kanban")}
          data-testid="nome-do-novo-funil"
          disabled={ocupado}
          maxLength={80}
        />
        <Input
          value={novo.descricao}
          onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
          placeholder={t("Para que serve (opcional)")}
          aria-label={t("Descrição do Kanban")}
          disabled={ocupado}
          maxLength={280}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("Começar com as colunas de")}</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Modelo de colunas")}>
          {[{ id: "", rotulo: t("Em branco") }, ...MODELOS_DE_KANBAN].map((m) => (
            <button
              key={m.id || "branco"}
              type="button"
              role="radio"
              aria-checked={novo.modelo === m.id}
              onClick={() => setNovo({ ...novo, modelo: m.id })}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                novo.modelo === m.id
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
              )}
              data-testid={`modelo-${m.id || "branco"}`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
        <ol className="mt-1 flex flex-wrap items-center gap-1.5" aria-label={t("Prévia das colunas")}>
          {colunasDaPrevia.map((c, i) => (
            <li key={`${c}-${i}`} className="flex items-center gap-1.5">
              <span className="rounded-md bg-surface-elevated px-2 py-1 text-[11px] text-text">{c}</span>
              {i < colunasDaPrevia.length - 1 && <span className="text-text-muted">›</span>}
            </li>
          ))}
        </ol>
        {modeloEscolhido && (
          <p className="text-xs text-text-muted">
            {t("O modelo já marca onde o cliente fecha e onde desiste, e diz ao agente para onde levar o card em cada passo. Tudo é editável depois em Configurar.")}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={criarFunil}
          disabled={ocupado || !novo.nome.trim()}
          data-testid="confirmar-novo-funil"
        >
          {t("Criar Kanban")}
        </Button>
        <Button variant="ghost" onClick={() => setNovo(null)} disabled={ocupado}>
          {t("Cancelar")}
        </Button>
      </div>
    </section>
  );

  const abrirCriacao = () => setNovo({ nome: "", descricao: "", modelo: "" });

  if (funis.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {formularioDeCriacao}
        {novo === null && (
          // ⚠️ O BOTÃO CRIA AQUI MESMO. É o estado de toda instalação em que o
          // gatilho de seed não rodou — e não pode mandar o usuário procurar um
          // botão em outro lugar.
          <EmptyPipeline
            primary={
              podeGerenciar ? { label: t("Criar meu primeiro Kanban"), onClick: abrirCriacao } : undefined
            }
          />
        )}
        {erro && (
          <p className="text-sm text-destructive" data-testid="erro-geral">
            {erro.texto}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {podeGerenciar && novo === null && (
        <div className="flex sm:justify-end">
          <Button onClick={abrirCriacao} disabled={ocupado} data-testid="novo-funil" className="w-full sm:w-auto">
            <Plus size={16} className="mr-2" aria-hidden /> {t("Novo Kanban")}
          </Button>
        </div>
      )}

      {formularioDeCriacao}

      {erro?.id === null && (
        <p className="text-sm text-destructive" data-testid="erro-geral">
          {erro.texto}
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {funis.map((funil, i) => {
          const renomeandoAqui = renomeando?.id === funil.id ? renomeando : null;
          const arquivandoAqui = arquivando?.id === funil.id ? arquivando : null;
          const erroDoCartao = erro?.id === funil.id ? erro.texto : null;
          const r = resumo[funil.id] ?? { abertos: 0, valorCents: 0, colunas: [] };
          const colunasComNegocio = r.colunas.filter((c) => c.abertos > 0);

          return (
            <li
              key={funil.id}
              data-testid={`funil-${funil.id}`}
              className="group relative flex flex-col overflow-hidden rounded-ios border border-border bg-surface shadow-xs transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              {/* A barra é a distribuição REAL dos negócios abertos pelas colunas.
                  Sem negócio, as colunas dividem a barra por igual. */}
              <div className="flex h-1.5 w-full" aria-hidden>
                {(colunasComNegocio.length > 0 ? colunasComNegocio : r.colunas).map((c, k) => (
                  <span
                    key={c.id}
                    className="h-full"
                    style={{
                      flexGrow: colunasComNegocio.length > 0 ? c.abertos : 1,
                      backgroundColor: c.color ?? CORES_DE_RESERVA[k % CORES_DE_RESERVA.length],
                    }}
                  />
                ))}
              </div>

              <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-ios-sm bg-accent-soft text-accent">
                    <Kanban size={20} weight="duotone" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {renomeandoAqui ? (
                      <div className="flex flex-col gap-2">
                        <Input
                          autoFocus
                          value={renomeandoAqui.nome}
                          onChange={(e) => setRenomeando({ id: funil.id, nome: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") aplicar(funil.id, { name: renomeandoAqui.nome });
                            if (e.key === "Escape") setRenomeando(null);
                          }}
                          aria-label={`${t("Novo nome de")} «${funil.name}»`}
                          data-testid={`nome-${funil.id}`}
                          disabled={ocupado}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => aplicar(funil.id, { name: renomeandoAqui.nome })}
                            disabled={ocupado || !renomeandoAqui.nome.trim()}
                            data-testid={`salvar-nome-${funil.id}`}
                          >
                            {t("Salvar")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRenomeando(null)} disabled={ocupado}>
                            {t("Cancelar")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Link
                        href={`/app/pipelines/${funil.id}`}
                        className="flex flex-col gap-0.5 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-ios focus-visible:after:ring-2 focus-visible:after:ring-accent"
                        data-testid={`abrir-${funil.id}`}
                      >
                        <span className="truncate text-base font-semibold leading-tight text-text">
                          {funil.name}
                        </span>
                        {funil.description && (
                          <span className="line-clamp-2 text-xs text-text-muted">{funil.description}</span>
                        )}
                      </Link>
                    )}
                  </div>
                  {funil.is_default && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      <Star size={11} weight="fill" aria-hidden />
                      {t("Padrão")}
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-2">
                  <div className="rounded-ios-sm bg-surface-elevated px-3 py-2">
                    <dt className="text-[11px] text-text-muted">{t("Negócios abertos")}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-text">{r.abertos}</dd>
                  </div>
                  <div className="rounded-ios-sm bg-surface-elevated px-3 py-2">
                    <dt className="text-[11px] text-text-muted">{t("Em aberto")}</dt>
                    <dd className="truncate text-lg font-semibold tabular-nums text-text">
                      {formatarReais(r.valorCents)}
                    </dd>
                  </div>
                </dl>

                {r.colunas.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label={t("Colunas")}>
                    {r.colunas.slice(0, 6).map((c, k) => (
                      <li
                        key={c.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted"
                      >
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: c.color ?? CORES_DE_RESERVA[k % CORES_DE_RESERVA.length] }}
                        />
                        {c.name}
                        <span className="tabular-nums text-text">{c.abertos}</span>
                      </li>
                    ))}
                    {r.colunas.length > 6 && (
                      <li className="px-1 text-[11px] text-text-muted">+{r.colunas.length - 6}</li>
                    )}
                  </ul>
                )}

                {erroDoCartao && (
                  <p className="text-sm leading-relaxed text-destructive" data-testid={`erro-${funil.id}`}>
                    {erroDoCartao}
                  </p>
                )}

                {arquivandoAqui && (
                  <div
                    className="relative z-10 space-y-3 rounded-ios-sm border border-border bg-surface-elevated p-3"
                    data-testid={`arquivar-painel-${funil.id}`}
                  >
                    {arquivandoAqui.erro ? (
                      // A recusa da rota, INTEIRA: é ela que diz qual formulário ou
                      // automação está no caminho, e o que fazer antes de tentar de novo.
                      <p className="text-sm leading-relaxed" data-testid={`arquivar-erro-${funil.id}`}>
                        {arquivandoAqui.erro}
                      </p>
                    ) : (
                      <p className="text-sm leading-relaxed">
                        {t("Arquivar")} «{funil.name}»?{" "}
                        {t(
                          "Ele sai desta lista e para de receber negócio novo. O histórico continua guardado, e nada é apagado.",
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => pedirArquivamento(funil.id, false)}
                        disabled={ocupado}
                        data-testid={`arquivar-confirmar-${funil.id}`}
                      >
                        {t("Arquivar")}
                      </Button>
                      {/* Excluir de vez só passa no Kanban que NUNCA recebeu negócio.
                          A rota recusa explicando, e a explicação aparece aqui. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => pedirArquivamento(funil.id, true)}
                        disabled={ocupado}
                        data-testid={`excluir-${funil.id}`}
                      >
                        {t("Excluir de vez")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setArquivando(null)} disabled={ocupado}>
                        {t("Cancelar")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {podeGerenciar && !renomeandoAqui && (
                // `relative z-10`: os botões ficam ACIMA do link que cobre o cartão
                // (o `after:inset-0` do nome), senão o clique abriria o Kanban.
                <div className="relative z-10 flex items-center gap-0.5 border-t border-border px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`${t("Subir")} «${funil.name}» ${t("na lista")}`}
                    title={t("Mover para a esquerda")}
                    data-testid={`subir-${funil.id}`}
                    disabled={ocupado || i === 0}
                    onClick={() => aplicar(funil.id, { depois_de: vizinhoAoMover(funis, i, "subir") })}
                  >
                    <CaretUp size={16} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`${t("Descer")} «${funil.name}» ${t("na lista")}`}
                    title={t("Mover para a direita")}
                    data-testid={`descer-${funil.id}`}
                    disabled={ocupado || i === funis.length - 1}
                    onClick={() => aplicar(funil.id, { depois_de: vizinhoAoMover(funis, i, "descer") })}
                  >
                    <CaretDown size={16} aria-hidden />
                  </Button>
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => setRenomeando({ id: funil.id, nome: funil.name })}
                    disabled={ocupado}
                    data-testid={`renomear-${funil.id}`}
                  >
                    <PencilSimple size={14} aria-hidden /> {t("Renomear")}
                  </Button>
                  {!funil.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => aplicar(funil.id, { is_default: true })}
                      disabled={ocupado}
                      data-testid={`padrao-${funil.id}`}
                    >
                      <Check size={14} aria-hidden /> {t("Tornar padrão")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`${t("Arquivar")} «${funil.name}»`}
                    title={t("Arquivar")}
                    onClick={() => {
                      setErro(null);
                      setArquivando({ id: funil.id, erro: null });
                    }}
                    disabled={ocupado}
                    data-testid={`arquivar-${funil.id}`}
                  >
                    <Archive size={16} aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
