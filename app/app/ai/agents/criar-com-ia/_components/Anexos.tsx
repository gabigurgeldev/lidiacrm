"use client";
/**
 * Anexos e materiais existentes no "Criar com IA".
 *
 * Cada anexo tem DUAS escolhas independentes:
 *  - "a IA lê": o texto vai junto nas perguntas, na escrita e nos ajustes;
 *  - "guardar como material": o texto vira um documento do agente (gravado só
 *    no clique de criar). Guarda-se o TEXTO, não o arquivo — a tela diz isso.
 *
 * O arquivo é lido pelo servidor (`construtor/anexos`) e descartado.
 */
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { Paperclip, Trash, Warning } from "@/lib/ui/icons";

export interface AnexoDaTela {
  id: string;
  nome: string;
  texto: string;
  chars: number;
  truncado: boolean;
  ler: boolean;
  guardar: boolean;
}

interface RespostaDosAnexos {
  data: {
    anexos: Array<
      | { nome: string; ok: true; texto: string; chars: number; truncado: boolean }
      | { nome: string; ok: false; motivo: string }
    >;
  };
}

/** Botão que lê os arquivos escolhidos e devolve os anexos (e os que falharam, como aviso). */
export function BotaoDeAnexar({
  aoAnexar,
  desabilitado,
}: {
  aoAnexar: (novos: AnexoDaTela[], falhas: string[]) => void;
  desabilitado?: boolean;
}) {
  const t = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = React.useState(false);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(arquivos).slice(0, 5)) form.append("arquivos", f);
    setLendo(true);
    try {
      const res = await fetch("/api/v1/ai/agents/construtor/anexos", { method: "POST", body: form });
      const json = (await res.json()) as RespostaDosAnexos & { error?: { message?: string } };
      if (!res.ok) throw Object.assign(new Error(json.error?.message ?? "erro"), { body: json });
      const novos: AnexoDaTela[] = [];
      const falhas: string[] = [];
      for (const a of json.data.anexos) {
        if (a.ok) {
          novos.push({ id: crypto.randomUUID(), nome: a.nome, texto: a.texto, chars: a.chars, truncado: a.truncado, ler: true, guardar: false });
        } else {
          falhas.push(`${a.nome}: ${a.motivo}`);
        }
      }
      aoAnexar(novos, falhas);
    } catch (err) {
      showApiError(err);
    } finally {
      setLendo(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
        className="hidden"
        onChange={(e) => void enviar(e.target.files)}
        data-testid="construtor-anexar-arquivo"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={desabilitado || lendo}
        onClick={() => input.current?.click()}
        data-testid="construtor-anexar"
      >
        <Paperclip className="mr-1.5 size-4" aria-hidden />
        {lendo ? t("Lendo arquivos…") : t("Anexar PDF, MD ou TXT")}
      </Button>
    </>
  );
}

export function ListaDeAnexos({
  anexos,
  aoMudar,
}: {
  anexos: AnexoDaTela[];
  aoMudar: (anexos: AnexoDaTela[]) => void;
}) {
  const t = useT();
  if (anexos.length === 0) return null;
  const mudar = (id: string, parcial: Partial<AnexoDaTela>) =>
    aoMudar(anexos.map((a) => (a.id === id ? { ...a, ...parcial } : a)));
  return (
    <ul className="flex flex-col gap-2" data-testid="construtor-anexos">
      {anexos.map((a) => (
        <li key={a.id} className="ios-grupo flex flex-col gap-1.5 px-3 py-2 text-sm" data-testid="construtor-anexo">
          <div className="flex items-center gap-2">
            <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{a.nome}</span>
            <span className="text-xs text-muted-foreground">{`${a.chars.toLocaleString()} ${t("caracteres")}`}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => aoMudar(anexos.filter((x) => x.id !== a.id))}
              aria-label={t("Remover anexo")}
            >
              <Trash className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={a.ler} onChange={(e) => mudar(a.id, { ler: e.target.checked })} />
              {t("A IA lê para montar o agente")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={a.guardar}
                onChange={(e) => mudar(a.id, { guardar: e.target.checked })}
                data-testid="construtor-anexo-guardar"
              />
              {t("Guardar como material do agente")}
            </label>
          </div>
          {a.truncado && (
            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
              <Warning className="size-3.5" aria-hidden />
              {t("Arquivo grande: só o começo do texto foi usado.")}
            </p>
          )}
        </li>
      ))}
      <li className="text-xs text-muted-foreground">
        {t("Do arquivo, guardamos o texto. O PDF original não fica salvo.")}
      </li>
    </ul>
  );
}

export interface MaterialExistente {
  id: string;
  name: string;
  source_type: string;
  is_active: boolean;
}

/** Os materiais que JÁ existem na organização, para o agente novo também ler. */
export function SeletorDeMateriais({
  escolhidos,
  aoMudar,
}: {
  escolhidos: string[];
  aoMudar: (ids: string[], todos: MaterialExistente[]) => void;
}) {
  const t = useT();
  const [aberto, setAberto] = React.useState(false);
  const [lista, setLista] = React.useState<MaterialExistente[] | null>(null);

  React.useEffect(() => {
    if (!aberto || lista !== null) return;
    apiClient
      .get<{ data: MaterialExistente[] }>("/api/v1/ai/knowledge/sources")
      .then((r) => setLista(r.data.filter((m) => m.is_active && m.source_type !== "conversas")))
      .catch(() => setLista([]));
  }, [aberto, lista]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAberto((a) => !a)}
        data-testid="construtor-usar-existentes"
      >
        {escolhidos.length > 0
          ? `${t("Materiais que já existem")} (${escolhidos.length})`
          : t("Usar material que já existe")}
      </Button>
      {aberto && (
        <div className="ios-grupo flex max-h-56 flex-col gap-1 overflow-y-auto px-3 py-2 text-sm">
          {lista === null && <span className="text-muted-foreground">{t("Carregando…")}</span>}
          {lista?.length === 0 && <span className="text-muted-foreground">{t("Ainda não há materiais cadastrados.")}</span>}
          {lista?.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={escolhidos.includes(m.id)}
                onChange={() =>
                  aoMudar(
                    escolhidos.includes(m.id) ? escolhidos.filter((x) => x !== m.id) : [...escolhidos, m.id].slice(0, 20),
                    lista,
                  )
                }
              />
              <span className="truncate">{m.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
