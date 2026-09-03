"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

/**
 * A planilha vira lista de contatos, dentro do editor de fluxo.
 *
 * ## Por que aqui, e não "vá para a tela de Disparos e cole os ids"
 *
 * Porque essa era a instrução que este campo dava antes, e ela é impossível de
 * seguir: o identificador de um contato não aparece em tela nenhuma do produto.
 * Quem montasse o bloco ficaria com um campo vazio e uma dica que manda buscar
 * algo que não existe onde ela diz.
 *
 * A rota `/api/v1/bulk-sends/importar-lista` já resolve planilha em contatos —
 * criando quem não existe, reaproveitando quem já está na base — e já devolve o
 * recorte honesto (quantos vão receber, quantos ficam de fora e por quê). É a
 * mesma rota que a tela de Disparos usa; aqui ela é chamada do editor.
 *
 * ## O que fica claro na tela, porque muda a decisão
 *
 * A importação acontece AGORA, em tempo de montagem, e congela os ids no bloco.
 * É o comportamento certo para "esta lista específica" e o errado para "todo
 * mundo que for entrando" — por isso o número importado fica visível, e a dica
 * ao lado manda usar marcador para o outro caso.
 */
interface Recorte {
  contact_ids: string[];
  criados: number;
  ja_existiam: number;
  linhas_com_erro: number;
  vao_receber: number;
  fora_por_motivo: Record<string, number>;
}

const NOME_DO_MOTIVO: Record<string, string> = {
  contact_blocked: "pediram para parar",
  consent_declined: "recusaram marketing",
  no_phone: "sem telefone",
  contact_anonymized: "anonimizados",
  contact_merged: "mesclados com outro",
};

export function ImportadorDeLista({
  quantos,
  aoImportar,
}: {
  /** Quantos contatos já estão congelados no bloco. */
  quantos: number;
  aoImportar: (ids: string[]) => void;
}) {
  const t = useT();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recorte, setRecorte] = useState<Recorte | null>(null);

  async function subir(arquivo: File) {
    setEnviando(true);
    setErro(null);
    try {
      const corpo = new FormData();
      corpo.append("file", arquivo);
      // `fetch` cru, e não o `apiClient`: ele serializa JSON, e aqui o corpo é
      // multipart — deixar o navegador montar o `Content-Type` com o boundary é
      // a única forma de o servidor conseguir separar as partes.
      const r = await fetch("/api/v1/bulk-sends/importar-lista", {
        method: "POST",
        body: corpo,
      });
      const json = (await r.json()) as { data?: Recorte; error?: { message?: string } };
      if (!r.ok || json.data === undefined) {
        setErro(json.error?.message ?? t("Não consegui ler a planilha."));
        return;
      }
      setRecorte(json.data);
      aoImportar(json.data.contact_ids);
    } catch {
      setErro(t("Não consegui enviar a planilha. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="importador-de-lista">
      <label className="inline-flex w-fit">
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={enviando}
          data-testid="campo-planilha"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            // Limpa o valor para que escolher O MESMO arquivo de novo dispare
            // outro `change` — sem isto, corrigir a planilha e subir a mesma
            // não faz nada, e a tela parece travada.
            e.target.value = "";
            if (arquivo !== undefined) void subir(arquivo);
          }}
        />
        <Button type="button" variant="outline" size="sm" asChild disabled={enviando}>
          <span>
            {enviando
              ? t("Lendo a planilha…")
              : quantos > 0
                ? t("Trocar a planilha")
                : t("Escolher planilha")}
          </span>
        </Button>
      </label>

      {erro !== null && (
        <p className="text-xs text-destructive" data-testid="erro-da-planilha">
          {erro}
        </p>
      )}

      {recorte === null && quantos > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="lista-congelada">
          {t("{n} contato(s) nesta lista.").replace("{n}", String(quantos))}
        </p>
      )}

      {recorte !== null && (
        <div className="rounded-md border p-3 text-xs" data-testid="recorte-da-planilha">
          <p className="font-medium">
            {t("{n} vão receber").replace("{n}", String(recorte.vao_receber))}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t("{c} criado(s), {e} já estavam na base.")
              .replace("{c}", String(recorte.criados))
              .replace("{e}", String(recorte.ja_existiam))}
          </p>
          {Object.entries(recorte.fora_por_motivo).length > 0 && (
            <p className="mt-1 text-muted-foreground">
              {t("Fora:")}{" "}
              {Object.entries(recorte.fora_por_motivo)
                .map(([motivo, n]) => `${n} ${t(NOME_DO_MOTIVO[motivo] ?? motivo)}`)
                .join(", ")}
            </p>
          )}
          {recorte.linhas_com_erro > 0 && (
            <p className="mt-1 text-destructive">
              {t("{n} linha(s) da planilha não puderam ser lidas.").replace(
                "{n}",
                String(recorte.linhas_com_erro),
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
