"use client";

/**
 * O cartão de UM ponto de IA, para ser usado fora da tela de provedores.
 *
 * Existe porque a escolha de modelo de um ponto mora em IA › Provedores, dentro
 * de "Configuração avançada" do grupo — e quem configura o coordenador não a
 * achava (2026-10-10: "não consigo escolher o modelo de decisão"). Em vez de
 * repetir a regra numa segunda tela, a tela do coordenador mostra o MESMO
 * cartão, que grava pelo mesmo PUT e com a mesma validação.
 */
import { useCallback, useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";

import { CartaoDoPonto, type Dados } from "./PainelDeProvedores";

export function ModeloDoPonto({ pontoId }: { pontoId: string }) {
  const t = useT();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/ai/providers");
      const json = (await res.json().catch(() => null)) as { data?: Dados; error?: { message?: string } } | null;
      if (!res.ok || !json?.data) {
        setErro(json?.error?.message ? t(json.error.message) : t("não consegui carregar a configuração"));
        return;
      }
      setErro(null);
      setDados(json.data);
    } catch {
      setErro(t("não consegui falar com o servidor"));
    }
  }, [t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Card className="p-3 text-sm text-muted-foreground">{erro}</Card>;
  if (!dados) return <div className="text-sm text-muted-foreground">{t("Carregando…")}</div>;
  const ponto = dados.pontos.find((p) => p.id === pontoId);
  if (!ponto) return null;
  return <CartaoDoPonto ponto={ponto} dados={dados} aoSalvar={carregar} />;
}
