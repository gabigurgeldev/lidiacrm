"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import {
  useCriarFluxo,
  useFluxos,
  useTrocarEstado,
  type FluxoDaLista,
} from "@/hooks/flows/useFlows";

export function FluxosClient() {
  const t = useT();
  const { data: fluxos, isLoading } = useFluxos();
  const criar = useCriarFluxo();
  const [nome, setNome] = useState("");

  async function aoCriar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (limpo === "") return;
    try {
      await criar.mutateAsync(limpo);
      setNome("");
      toast.success(t("Fluxo criado. Abra para montar."));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Não consegui criar o fluxo."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={aoCriar} className="flex max-w-xl gap-2" data-testid="form-novo-fluxo">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={t("Nome do fluxo — por exemplo, Novo lead do Meta Ads")}
          maxLength={80}
          data-testid="campo-nome-do-fluxo"
        />
        <Button type="submit" disabled={criar.isPending || nome.trim() === ""}>
          {t("Criar fluxo")}
        </Button>
      </form>

      {isLoading && <Skeleton className="h-32 w-full" />}

      {!isLoading && (fluxos?.length ?? 0) === 0 && (
        <Card className="p-8 text-center" data-testid="fluxos-vazio">
          <p className="text-sm font-medium">{t("Você ainda não tem nenhum fluxo.")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Um fluxo é uma sequência que roda sozinha quando algo acontece — por exemplo: chegou um lead, distribua para um vendedor, avise ele no WhatsApp e, se ninguém atender em 5 minutos, passe para outro.",
            )}
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-3" data-testid="lista-de-fluxos">
        {(fluxos ?? []).map((fluxo) => (
          <LinhaDoFluxo key={fluxo.id} fluxo={fluxo} />
        ))}
      </ul>
    </div>
  );
}

function LinhaDoFluxo({ fluxo }: { fluxo: FluxoDaLista }) {
  const t = useT();
  const trocar = useTrocarEstado(fluxo.id);

  const ligado = fluxo.status === "active";
  const publicado = fluxo.active_version_id !== null;

  async function alternar() {
    try {
      await trocar.mutateAsync(ligado ? "paused" : "active");
      toast.success(ligado ? t("Fluxo pausado.") : t("Fluxo ligado."));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Não consegui mudar o estado."));
    }
  }

  return (
    <li>
      <Card className="flex items-center gap-4 p-4" data-testid={`fluxo-${fluxo.id}`}>
        <div className="min-w-0 flex-1">
          <Link href={`/app/flows/${fluxo.id}`} className="text-sm font-medium hover:underline">
            {fluxo.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {publicado
              ? t("Publicado e pronto para ligar.")
              : t("Rascunho — publique antes de ligar.")}
          </p>
        </div>
        <Badge variant={ligado ? "default" : "secondary"} data-testid={`estado-${fluxo.id}`}>
          {ligado ? t("Ligado") : fluxo.status === "paused" ? t("Pausado") : t("Rascunho")}
        </Badge>
        <Button
          variant={ligado ? "outline" : "default"}
          size="sm"
          onClick={alternar}
          // Ligar sem versão publicada seria um fluxo ativo que o motor acha e
          // não consegue armar: ativo na tela, morto na prática.
          disabled={trocar.isPending || (!publicado && !ligado)}
          data-testid={`alternar-${fluxo.id}`}
        >
          {ligado ? t("Pausar") : t("Ligar")}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/flows/${fluxo.id}`}>{t("Abrir")}</Link>
        </Button>
      </Card>
    </li>
  );
}
