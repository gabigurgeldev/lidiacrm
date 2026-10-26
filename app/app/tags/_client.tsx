"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

import { TagChip } from "@/components/tags/TagChip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import {
  useColunasDaTag,
  useCriarTag,
  useEditarTag,
  useTags,
  type TagDoCatalogo,
} from "@/hooks/tags/useTags";
import { ApiError } from "@/lib/api/types";
import { PALETA_DE_TAGS } from "@/lib/tags/normalizar";
import {
  Archive,
  ArrowCounterClockwise,
  Kanban,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Tag,
} from "@/lib/ui/icons";

export interface KanbanDaTela {
  id: string;
  name: string;
  colunas: Array<{ id: string; name: string }>;
}

interface Rascunho {
  id: string | null;
  name: string;
  color: string;
  description: string;
  /** pipeline_id → stage_id ("" = nenhuma coluna naquele Kanban). */
  colunas: Record<string, string>;
  colunasOriginais: Record<string, string>;
}

function colunasDe(tag: TagDoCatalogo | null): Record<string, string> {
  return Object.fromEntries((tag?.colunas ?? []).map((c) => [c.pipeline_id, c.stage_id]));
}

function mesmasColunas(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.entries(a).filter(([, v]) => v);
  const kb = Object.entries(b).filter(([, v]) => v);
  return ka.length === kb.length && ka.every(([k, v]) => b[k] === v);
}

/** A recusa da rota é a explicação; nunca troque por "erro ao salvar". */
function textoDoErro(e: unknown, t: (s: string) => string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return t("Não consegui completar essa ação. Tente de novo.");
}

function codigoDoErro(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

export function TagsClient({
  podeGerenciar,
  kanbans,
}: {
  podeGerenciar: boolean;
  kanbans: KanbanDaTela[];
}) {
  const t = useT();
  const [verArquivadas, setVerArquivadas] = useState(false);
  const { data: tags, isLoading, error } = useTags({ comUso: true, incluirArquivadas: verArquivadas });
  const criar = useCriarTag();
  const editar = useEditarTag();
  const vincular = useColunasDaTag();

  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroDoForm, setErroDoForm] = useState<string | null>(null);
  const [pedirFusao, setPedirFusao] = useState(false);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    const lista = tags ?? [];
    return q ? lista.filter((tag) => tag.name.toLocaleLowerCase("pt-BR").includes(q)) : lista;
  }, [tags, busca]);

  const ativas = (tags ?? []).filter((tag) => !tag.is_archived).length;
  const ocupado = criar.isPending || editar.isPending || vincular.isPending;

  function abrirNova() {
    setErroDoForm(null);
    setPedirFusao(false);
    setRascunho({
      id: null,
      name: busca.trim(),
      color: PALETA_DE_TAGS[(tags?.length ?? 0) % PALETA_DE_TAGS.length]!,
      description: "",
      colunas: {},
      colunasOriginais: {},
    });
  }

  function abrirEdicao(tag: TagDoCatalogo) {
    setErroDoForm(null);
    setPedirFusao(false);
    setRascunho({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      description: tag.description ?? "",
      colunas: colunasDe(tag),
      colunasOriginais: colunasDe(tag),
    });
  }

  function salvar(fundir = false) {
    if (!rascunho) return;
    const name = rascunho.name.trim();
    if (!name) {
      setErroDoForm(t("Dê um nome à tag."));
      return;
    }
    setErroDoForm(null);
    const descricao = rascunho.description.trim() || null;
    const stageIds = Object.values(rascunho.colunas).filter(Boolean);
    const mudouColunas = !mesmasColunas(rascunho.colunas, rascunho.colunasOriginais);
    // O vínculo é um segundo pedido: só depois que a tag existe (ou foi salva).
    const vincularSePreciso = (tagId: string) => {
      if (!mudouColunas) {
        setRascunho(null);
        return;
      }
      vincular.mutate(
        { tagId, stageIds },
        {
          onSuccess: () => setRascunho(null),
          onError: (e) => setErroDoForm(textoDoErro(e, t)),
        },
      );
    };
    if (rascunho.id === null) {
      criar.mutate(
        { name, color: rascunho.color, description: descricao },
        {
          onSuccess: (r) => {
            setRascunho((atual) => (atual ? { ...atual, id: r.data.id } : atual));
            vincularSePreciso(r.data.id);
          },
          onError: (e) => setErroDoForm(textoDoErro(e, t)),
        },
      );
      return;
    }
    editar.mutate(
      {
        id: rascunho.id,
        patch: { name, color: rascunho.color, description: descricao, ...(fundir ? { fundir: true } : {}) },
      },
      {
        onSuccess: (r) => {
          setPedirFusao(false);
          // Fundida: a tag de destino já recebeu os vínculos da antiga no banco
          // (fn_renomear_tag); reaplicar as colunas do diálogo apagaria os dela.
          if (r.data.fundida_em) setRascunho(null);
          else vincularSePreciso(r.data.id);
        },
        onError: (e) => {
          if (codigoDoErro(e) === "tag_merge_required") setPedirFusao(true);
          setErroDoForm(textoDoErro(e, t));
        },
      },
    );
  }

  function alternarArquivo(tag: TagDoCatalogo) {
    editar.mutate({ id: tag.id, patch: { is_archived: !tag.is_archived } });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar tag")}
            className="pl-9"
            aria-label={t("Buscar tag")}
            data-testid="busca-de-tag"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={verArquivadas} onCheckedChange={setVerArquivadas} />
          {t("Mostrar arquivadas")}
        </label>
        {podeGerenciar && (
          <Button onClick={abrirNova} data-testid="nova-tag">
            <Plus size={16} /> {t("Nova tag")}
          </Button>
        )}
      </div>

      {error ? (
        <Card className="p-4 text-sm text-destructive">{textoDoErro(error, t)}</Card>
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Tag size={36} weight="duotone" className="text-muted-foreground" />
          <p className="font-medium">
            {busca ? t("Nenhuma tag com esse nome.") : t("Nenhuma tag ainda.")}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("Tags organizam os contatos: \"VIP\", \"Orçamento enviado\", \"Pós-venda\". Crie as da sua empresa aqui.")}
          </p>
          {podeGerenciar && (
            <Button onClick={abrirNova} variant="outline">
              <Plus size={16} /> {busca ? t("Criar esta tag") : t("Criar a primeira tag")}
            </Button>
          )}
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {ativas} {ativas === 1 ? t("tag ativa") : t("tags ativas")}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-de-tags">
            {visiveis.map((tag) => (
              <li key={tag.id}>
                <Card
                  className="group flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-md"
                  data-testid={`tag-${tag.name}`}
                  style={{ borderTop: `3px solid ${tag.color}` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <TagChip nome={tag.name} cor={tag.color} />
                    {podeGerenciar && (
                      <div className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t("Editar tag")}
                          onClick={() => abrirEdicao(tag)}
                        >
                          <PencilSimple size={16} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={tag.is_archived ? t("Reativar tag") : t("Arquivar tag")}
                          disabled={editar.isPending}
                          onClick={() => alternarArquivo(tag)}
                        >
                          {tag.is_archived ? <ArrowCounterClockwise size={16} /> : <Archive size={16} />}
                        </Button>
                      </div>
                    )}
                  </div>

                  {tag.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{tag.description}</p>
                  )}

                  <div className="mt-auto flex flex-col gap-2 text-xs text-muted-foreground">
                    <span>
                      {tag.uso ?? 0} {(tag.uso ?? 0) === 1 ? t("contato") : t("contatos")}
                      {tag.is_archived && <span className="ml-2 font-medium">· {t("arquivada")}</span>}
                    </span>
                    {tag.colunas.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tag.colunas.map((c) => (
                          <Link
                            key={c.stage_id}
                            href={`/app/pipelines/${c.pipeline_id}`}
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground hover:bg-muted/70"
                          >
                            <Kanban size={12} />
                            {c.pipeline_name} › {c.stage_name}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <span className="italic">{t("Sem coluna de Kanban")}</span>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={rascunho !== null} onOpenChange={(aberto) => !aberto && setRascunho(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rascunho?.id ? t("Editar tag") : t("Nova tag")}</DialogTitle>
            <DialogDescription>
              {rascunho?.id
                ? t("Renomear muda a tag em todos os contatos que já a têm.")
                : t("A tag fica disponível para toda a equipe aplicar nos contatos.")}
            </DialogDescription>
          </DialogHeader>

          {rascunho && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                salvar();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nome-da-tag">{t("Nome")}</Label>
                <Input
                  id="nome-da-tag"
                  autoFocus
                  maxLength={40}
                  value={rascunho.name}
                  onChange={(e) => {
                    setPedirFusao(false);
                    setRascunho({ ...rascunho, name: e.target.value });
                  }}
                  data-testid="nome-da-tag"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t("Cor")}</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Cor")}>
                  {PALETA_DE_TAGS.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      role="radio"
                      aria-checked={rascunho.color === cor}
                      aria-label={cor}
                      onClick={() => setRascunho({ ...rascunho, color: cor })}
                      className="size-7 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 aria-checked:ring-2 aria-checked:ring-foreground"
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="descricao-da-tag">{t("Para que serve (opcional)")}</Label>
                <Textarea
                  id="descricao-da-tag"
                  rows={2}
                  maxLength={280}
                  value={rascunho.description}
                  onChange={(e) => setRascunho({ ...rascunho, description: e.target.value })}
                />
              </div>

              {kanbans.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t("Coluna do Kanban (opcional)")}</span>
                  <p className="text-xs text-muted-foreground">
                    {t("Ao aplicar a tag num contato, o negócio dele vai para esta coluna. Mover um card para a coluna também dá a tag ao contato.")}
                  </p>
                  <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
                    {kanbans.map((k) => (
                      <label key={k.id} className="flex items-center gap-2 text-sm">
                        <span className="w-32 shrink-0 truncate text-muted-foreground" title={k.name}>
                          {k.name}
                        </span>
                        <select
                          className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                          value={rascunho.colunas[k.id] ?? ""}
                          onChange={(e) =>
                            setRascunho({ ...rascunho, colunas: { ...rascunho.colunas, [k.id]: e.target.value } })
                          }
                          data-testid={`coluna-da-tag-${k.name}`}
                        >
                          <option value="">{t("Nenhuma coluna")}</option>
                          {k.colunas.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">{t("Prévia")}</span>
                <TagChip nome={rascunho.name.trim() || t("nome da tag")} cor={rascunho.color} />
              </div>

              {erroDoForm && (
                <p className="text-sm text-destructive" role="alert">
                  {erroDoForm}
                </p>
              )}

              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" onClick={() => setRascunho(null)}>
                  {t("Cancelar")}
                </Button>
                {pedirFusao ? (
                  <Button type="button" variant="destructive" disabled={ocupado} onClick={() => salvar(true)}>
                    {t("Juntar as duas tags")}
                  </Button>
                ) : (
                  <Button type="submit" disabled={ocupado} data-testid="salvar-tag">
                    {t("Salvar")}
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
