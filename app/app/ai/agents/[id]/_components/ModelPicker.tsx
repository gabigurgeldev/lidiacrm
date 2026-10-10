"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";
import { useT } from "@/hooks/i18n/useT";

/**
 * Derivado de `lib/ai/pontos/provedores.ts` — a mesma lista única da tela de
 * Credenciais e da rota. Como literal aqui, o seletor de modelo do agente não
 * conseguia representar um agente publicado em OpenRouter.
 */
export type Provider = (typeof PROVEDORES)[number]["id"];

export interface ModelOption {
  provider: Provider;
  model_id: string;
  display_name: string;
  context_window: number | null;
  is_default_for_provider: boolean;
}

interface Props {
  provider: Provider;
  value: string;
  onChange: (modelId: string, ctx?: { contextWindow: number | null }) => void;
  disabled?: boolean;
  id?: string;
  /**
   * Texto do estado "nada escolhido". Existe porque nem todo uso deste seletor
   * trata vazio como erro: no papel Operador, vazio SIGNIFICA "usa o mesmo
   * modelo que conversa", e chamar isso de "Selecione um modelo" mentiria.
   */
  placeholder?: string;
}

interface ApiResponse {
  data: { models: ModelOption[] };
}

const QUERY_KEY = (provider: Provider) => ["ai", "providers", provider, "models"] as const;

/**
 * O provedor tem catálogo sincronizável — hoje só a OpenRouter. Deriva do
 * MESMO array que a tela de Credenciais usa, e não de uma lista própria: duas
 * listas divergiriam na primeira vez que um provedor novo entrasse.
 */
function catalogoSincronizavel(provider: Provider): boolean {
  return PROVEDORES.find((p) => p.id === provider)?.catalogoSincronizavel ?? false;
}

export type EstadoDoPicker = "com_opcoes" | "erro" | "vazio_sem_sync" | "vazio_de_verdade";

/**
 * A decisão que este arquivo existe para acertar, isolada da árvore de JSX.
 *
 * Exportada e testada DIRETO, sem abrir o `<Select>`: o Radix não abre em
 * jsdom (`target.hasPointerCapture is not a function`) — mesma decisão de
 * `EdgeConfigPanel.test.tsx` e `PainelDoNo.paralelo.test.tsx`. Um teste que
 * dependesse do dropdown mediria o ambiente, não a regra.
 *
 * `models.length === 0` sozinho não diz NADA sobre a causa, e é exatamente
 * isso que colapsava três causas na mesma frase "Nenhum modelo disponível" —
 * medido em produção: OpenRouter com chave validada, catálogo global
 * (`ai_models`) com zero linhas porque o cron de sync nunca tinha rodado, e a
 * tela sem nenhuma pista do porquê.
 */
export function estadoDoPicker(input: {
  totalDeModelos: number;
  carregando: boolean;
  comErro: boolean;
  sincronizavel: boolean;
}): EstadoDoPicker {
  if (input.carregando) return "com_opcoes";
  if (input.comErro) return "erro";
  if (input.totalDeModelos > 0) return "com_opcoes";
  return input.sincronizavel ? "vazio_sem_sync" : "vazio_de_verdade";
}

export function ModelPicker({ provider, value, onChange, disabled, id, placeholder }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY(provider),
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });

  const sincronizar = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/ai/providers/${provider}/sync`, {}),
    onSuccess: () => {
      toast.success(t("Catálogo sincronizado."));
      void qc.invalidateQueries({ queryKey: QUERY_KEY(provider) });
    },
    onError: showApiError,
  });

  const models = query.data ?? [];
  const estado = estadoDoPicker({
    totalDeModelos: models.length,
    carregando: query.isLoading,
    comErro: query.isError,
    sincronizavel: catalogoSincronizavel(provider),
  });

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("Modelo")}</Label>
      <Select
        value={value || undefined}
        onValueChange={(v) => {
          const m = models.find((m) => m.model_id === v);
          onChange(v, { contextWindow: m?.context_window ?? null });
        }}
        disabled={disabled || query.isLoading}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={query.isLoading ? t("Carregando…") : (placeholder ?? t("Selecione um modelo"))} />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.model_id} value={m.model_id}>
              {m.display_name}
              {m.is_default_for_provider ? ` · ${t("padrão")}` : ""}
            </SelectItem>
          ))}
          {estado === "erro" ? (
            <SelectItem value="__erro__" disabled>
              {t("Não deu para carregar os modelos. Tente de novo.")}
            </SelectItem>
          ) : null}
          {estado === "vazio_de_verdade" ? (
            <SelectItem value="__none__" disabled>
              {t("Nenhum modelo disponível")}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {/*
        Fora do <Select> de propósito: um <SelectItem disabled> não aceita
        clique, então o botão de sincronizar não pode viver dentro do popover —
        precisaria fechar o popover pra depois clicar em outro lugar. Aqui ele
        aparece junto do campo, sempre visível quando o catálogo está vazio.
      */}
      {estado === "vazio_sem_sync" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("O catálogo desta conta ainda não foi sincronizado.")}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={sincronizar.isPending}
            onClick={() => sincronizar.mutate()}
          >
            {sincronizar.isPending ? t("Sincronizando…") : t("Sincronizar catálogo agora")}
          </Button>
        </div>
      ) : null}
      {catalogoSincronizavel(provider) ? (
        <BuscaNaOrigem
          provider={provider}
          disabled={disabled}
          onEscolher={(m) => onChange(m.model_id, { contextWindow: m.context_window })}
          sincronizando={sincronizar.isPending}
          onSincronizar={estado === "vazio_sem_sync" ? null : () => sincronizar.mutate()}
        />
      ) : null}
    </div>
  );
}

/** Um resultado da busca ao vivo (`GET .../models/search`). */
export interface ModeloDaBusca {
  model_id: string;
  display_name: string;
  context_window: number | null;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
  supports_tools: boolean;
  no_catalogo: boolean;
}

/**
 * Centavos por milhão de tokens → "US$ 3,00". `null` é preço DESCONHECIDO e
 * aparece como "?", nunca como grátis — mesma regra de `precoParaCentavosPorMilhao`.
 */
export function precoLegivel(cents: number | null): string {
  if (cents === null) return "?";
  return `US$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Oferece "usar este código" quando o termo TEM cara de código da OpenRouter
 * (`fabricante/modelo`) e a busca não devolveu esse código exato. Sem a barra,
 * é um nome ("sonnet") — oferecer gravá-lo como código seria convidar ao 404.
 */
export function ofereceUsarCodigo(termo: string, resultados: readonly { model_id: string }[]): boolean {
  const codigo = termo.trim();
  if (!/^[^\s/]+\/\S+$/.test(codigo)) return false;
  return !resultados.some((m) => m.model_id === codigo);
}

/**
 * A busca na PRÓPRIA OpenRouter, para o modelo que o catálogo ainda não tem.
 *
 * Por que existe: o `<Select>` acima só lista `ai_models`, e essa lista só muda
 * quando o cron diário roda — modelo lançado hoje não dava para escolher, e não
 * havia onde digitar o código. Escolher aqui passa pelo POST que CONFERE o
 * código na origem e grava a linha no catálogo com o preço real; só então o
 * agente pode ser publicado (a publicação recusa modelo fora de `ai_models`).
 *
 * Fora do `<Select>` pelo mesmo motivo do botão de sincronizar: é um campo de
 * texto com lista clicável, e o Radix não abre em jsdom.
 */
function BuscaNaOrigem({
  provider,
  disabled,
  onEscolher,
  sincronizando,
  onSincronizar,
}: {
  provider: Provider;
  disabled?: boolean;
  onEscolher: (m: { model_id: string; context_window: number | null }) => void;
  sincronizando: boolean;
  onSincronizar: (() => void) | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [termo, setTermo] = React.useState("");
  const [termoFirme, setTermoFirme] = React.useState("");

  // Espera a pessoa parar de digitar: cada busca vai à origem (com memória
  // curta no servidor), e uma por tecla seria lento e inútil.
  React.useEffect(() => {
    const id = setTimeout(() => setTermoFirme(termo.trim()), 300);
    return () => clearTimeout(id);
  }, [termo]);

  const busca = useQuery({
    queryKey: ["ai", "providers", provider, "models", "search", termoFirme] as const,
    queryFn: async () => {
      const res = await apiClient.get<{ data: { models: ModeloDaBusca[] } }>(
        `/api/v1/ai/providers/${provider}/models/search?q=${encodeURIComponent(termoFirme)}`,
      );
      return res.data.models;
    },
    enabled: termoFirme.length >= 2,
    staleTime: 60_000,
  });

  const limpar = () => {
    setTermo("");
    setTermoFirme("");
  };

  const adicionar = useMutation({
    mutationFn: async (modelId: string) => {
      const res = await apiClient.post<{
        data: { model: { model_id: string; context_window: number | null } };
      }>(`/api/v1/ai/providers/${provider}/models`, { model_id: modelId });
      return res.data.model;
    },
    onSuccess: async (model) => {
      // Recarrega a lista ANTES de escolher: o `<Select>` só mostra o valor se
      // houver um item com ele, e escolher antes deixaria o campo em branco.
      await qc.invalidateQueries({ queryKey: QUERY_KEY(provider) });
      onEscolher(model);
      toast.success(t("Modelo adicionado e escolhido."));
      limpar();
    },
    onError: showApiError,
  });

  const escolher = (m: ModeloDaBusca) => {
    // Já no catálogo: nada a gravar, só escolher.
    if (m.no_catalogo) {
      onEscolher(m);
      limpar();
      return;
    }
    adicionar.mutate(m.model_id);
  };

  const resultados = busca.data ?? [];
  const ocupado = disabled || adicionar.isPending;
  const podeUsarCodigo = !busca.isLoading && !busca.isError && ofereceUsarCodigo(termoFirme, resultados);

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${provider}-busca-modelo`} className="text-xs font-normal text-muted-foreground">
          {t("Não achou o modelo? Busque na OpenRouter ou cole o código")}
        </Label>
        {onSincronizar ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-xs"
            disabled={sincronizando || disabled}
            onClick={onSincronizar}
          >
            {sincronizando ? t("Sincronizando…") : t("Atualizar lista da OpenRouter")}
          </Button>
        ) : null}
      </div>
      <Input
        id={`${provider}-busca-modelo`}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder={t("Ex.: sonnet, gemini, ou anthropic/claude-sonnet-4.5")}
        disabled={ocupado}
        autoComplete="off"
      />
      {termoFirme.length >= 2 ? (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-sm border border-border p-1">
          {busca.isLoading ? (
            <p className="p-2 text-xs text-muted-foreground">{t("Buscando na OpenRouter…")}</p>
          ) : busca.isError ? (
            <p className="p-2 text-xs text-destructive">
              {t("Não conseguimos falar com a OpenRouter agora. Tente de novo em instantes.")}
            </p>
          ) : resultados.length === 0 && !podeUsarCodigo ? (
            <p className="p-2 text-xs text-muted-foreground">
              {t("Nenhum modelo da OpenRouter com esse nome.")}
            </p>
          ) : null}
          {resultados.map((m) => (
            <button
              key={m.model_id}
              type="button"
              disabled={ocupado}
              onClick={() => escolher(m)}
              className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent-soft disabled:opacity-55"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{m.display_name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {m.no_catalogo ? t("já na lista") : t("adicionar")}
                </span>
              </span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {m.model_id}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {t("Entrada")} {precoLegivel(m.input_price_per_million_cents)} · {t("saída")}{" "}
                {precoLegivel(m.output_price_per_million_cents)} {t("por 1M de tokens")}
              </span>
              {!m.supports_tools ? (
                <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                  {t("Não usa ferramentas: conversa, mas não mexe no funil nem registra nada.")}
                </span>
              ) : null}
            </button>
          ))}
          {podeUsarCodigo ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={ocupado}
              onClick={() => adicionar.mutate(termoFirme)}
            >
              {adicionar.isPending ? t("Conferindo na OpenRouter…") : `${t("Usar o código")} ${termoFirme}`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function useModelMeta(provider: Provider, modelId: string): ModelOption | null {
  const query = useQuery({
    queryKey: QUERY_KEY(provider),
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });
  return (query.data ?? []).find((m) => m.model_id === modelId) ?? null;
}
