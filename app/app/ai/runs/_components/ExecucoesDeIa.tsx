"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

/**
 * A tela de execuções de IA.
 *
 * Abre pelo RESUMO, não pela lista. A pergunta que traz alguém aqui é "está
 * tudo bem?", e obrigar a ler cem linhas para descobrir isso é como um painel
 * de log para de ser aberto. A lista completa fica logo abaixo, para quem já
 * sabe o que procura.
 *
 * Cada falha mostra três coisas, nesta ordem: o que o CLIENTE viu acontecer, o
 * que fazer a respeito, e só então a mensagem crua do provedor. A ordem é a
 * decisão de desenho mais importante aqui — invertê-la faz a tela abrir com
 * jargão e devolve ao operador o trabalho de adivinhação que ela veio acabar.
 */
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { Aviso, Grupo, Linha, PaginaAjustes, Segmentado } from "@/components/ajustes";
import { CheckCircle, Warning } from "@/lib/ui/icons";

/**
 * O MESMO formato da tela de Uso — as duas leem `llm_calls.cost_cents`, que é
 * centavo de DÓLAR (`pricing.ts` cota o provedor em USD).
 */
const usd = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  // 4 casas porque uma execução isolada custa fração de centavo, e arredondar
  // para 2 mostraria "R$ 0,00" para todas elas — o zero que não é zero.
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

interface Execucao {
  id: string;
  purpose: string;
  pontoRotulo: string;
  provider: string;
  model: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  consequencia: string | null;
  oQueFazer: string | null;
  porQueEsteModelo: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number | null;
  latency_ms: number | null;
  created_at: string;
}

interface Resumo {
  total: number;
  erros: number;
  porCodigo: Array<{ codigo: string; quantas: number; oQueFazer: string | null }>;
}

export function ExecucoesDeIa() {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [soErros, setSoErros] = useState(false);

  const carregar = useCallback(async () => {
    // Mesmo tratamento do painel de provedores, e pela mesma razão medida lá:
    // sem ele, uma resposta não-JSON prende a tela em "Carregando…" sem nada
    // explicando — a falha muda que estas telas existem para acabar.
    try {
      const res = await fetch(`/api/v1/ai/runs${soErros ? "?status=erro" : ""}`);
      const texto = await res.text();
      let json: { data?: { execucoes: Execucao[]; resumo: Resumo }; error?: { message?: string } };
      try {
        json = JSON.parse(texto);
      } catch {
        setErro(`${t("resposta inesperada do servidor")} (${res.status}): ${texto.slice(0, 200)}`);
        return;
      }
      if (!res.ok) {
        setErro(
          json?.error?.message ? t(json.error.message) : `${t("não consegui carregar")} (${res.status})`,
        );
        return;
      }
      setErro(null);
      setExecucoes(json.data!.execucoes);
      setResumo(json.data!.resumo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("não consegui falar com o servidor"));
    }
  }, [soErros, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const cabecalho = {
    className: "mx-auto w-full max-w-5xl",
    testid: "execucoes-de-ia",
    titulo: t("Execuções de IA"),
    descricao: t(
      "Tudo que a inteligência artificial fez por aqui — e, quando algo falhou, o que aconteceu e o que fazer.",
    ),
  };

  if (erro) {
    return (
      <PaginaAjustes {...cabecalho}>
        <Grupo titulo={t("Não consegui carregar as execuções")}>
          <Linha
            icone={<Warning size={18} className="text-destructive" />}
            titulo={<span className="whitespace-normal">{erro}</span>}
            controle={
              <Button size="sm" variant="outline" onClick={() => void carregar()}>
                {t("Tentar de novo")}
              </Button>
            }
          />
        </Grupo>
      </PaginaAjustes>
    );
  }

  if (!execucoes || !resumo) {
    return (
      <PaginaAjustes {...cabecalho}>
        <Aviso texto={t("Carregando…")} />
      </PaginaAjustes>
    );
  }

  return (
    <PaginaAjustes {...cabecalho}>
      {/* O resumo responde "está tudo bem?" antes da lista. */}
      <Grupo titulo={t("Resumo")} testid="resumo">
        {resumo.erros === 0 ? (
          <Linha
            icone={<CheckCircle size={18} className="text-emerald-600 dark:text-emerald-500" />}
            titulo={t("Nenhuma falha")}
            descricao={`${t("nas últimas")} ${resumo.total} ${t("execuções.")}`}
          />
        ) : (
          <>
            <Linha
              icone={<Warning size={18} className="text-destructive" />}
              titulo={
                <span className="text-destructive" data-testid="tem-falhas">
                  {resumo.erros} {t("de")} {resumo.total} {t("execuções falharam.")}
                </span>
              }
            />
            {resumo.porCodigo.map((c) => (
              <Linha
                key={c.codigo}
                titulo={<span className="whitespace-normal">{c.oQueFazer ? t(c.oQueFazer) : c.codigo}</span>}
                valor={<span className="font-mono text-xs">{c.quantas}×</span>}
              />
            ))}
          </>
        )}
      </Grupo>

      <Segmentado<"todas" | "falhas">
        valor={soErros ? "falhas" : "todas"}
        aoMudar={(v) => setSoErros(v === "falhas")}
        rotuloAcessivel={t("Quais execuções mostrar")}
        className="self-start"
        testid="filtro-erros"
        opcoes={[
          { valor: "todas", rotulo: t("Todas") },
          { valor: "falhas", rotulo: t("Só as falhas") },
        ]}
      />

      {execucoes.length === 0 ? (
        <Grupo testid="lista-vazia">
          <Linha
            titulo={
              <span className="whitespace-normal">
                {soErros
                  ? t("Nenhuma falha registrada.")
                  : t("Nenhuma execução ainda. Assim que o agente atender alguém, aparece aqui.")}
              </span>
            }
          />
        </Grupo>
      ) : (
        <Grupo titulo={soErros ? t("Falhas") : t("Últimas execuções")}>
          {execucoes.map((e) => (
            <div key={e.id} className="ios-linha flex-col items-stretch gap-1.5" data-testid={`execucao-${e.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t(e.pontoRotulo)}</span>
                  {e.status === "erro" && (
                    <Badge variant="destructive" className="text-xs">
                      {t("falhou")}
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {e.provider} · {e.model}
                </span>
              </div>

              {e.status === "erro" ? (
                <div className="space-y-2 text-sm">
                  {/* 1º: o que o CLIENTE viu. */}
                  {e.consequencia && (
                    <p data-testid="consequencia">
                      <span className="font-medium">{t("O que aconteceu:")}</span> {t(e.consequencia)}
                    </p>
                  )}
                  {/* 2º: o que fazer. */}
                  {e.oQueFazer && (
                    <p className="text-muted-foreground" data-testid="o-que-fazer">
                      <span className="font-medium">{t("O que fazer:")}</span> {t(e.oQueFazer)}
                    </p>
                  )}
                  {/* 3º: só então, o texto cru — para quem for investigar. */}
                  {e.error_message && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">{t("Mensagem técnica do provedor")}</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-2">
                        {e.error_message}
                        {e.http_status ? `
(${t("código")} ${e.http_status})` : ""}
                      </pre>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {e.input_tokens + e.output_tokens} tokens
                  {e.latency_ms !== null ? ` · ${e.latency_ms} ms` : ""}
                  {/* `cost_cents` está em CENTAVOS de dólar — o mesmo formato da tela de Uso. */}
                  {e.cost_cents !== null ? ` · ${usd.format(e.cost_cents / 100)}` : ""}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                {new Date(e.created_at).toLocaleString(tagDoIdioma)}
                {e.porQueEsteModelo ? ` · ${t(e.porQueEsteModelo)}` : ""}
              </p>
            </div>
          ))}
        </Grupo>
      )}
    </PaginaAjustes>
  );
}
