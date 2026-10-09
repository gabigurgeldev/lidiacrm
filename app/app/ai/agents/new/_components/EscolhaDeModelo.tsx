"use client";
/**
 * "Começar de um modelo" — o primeiro bloco da tela de novo agente.
 *
 * A escolha vive na URL (`?modelo=clinica&tom=…`) e não em estado local: quem
 * troca de modelo recebe o formulário preenchido de novo pelo servidor, que é
 * quem sabe o nome do negócio e o que ele faz (é o "onde trabalha" do texto).
 * E um link copiado abre no mesmo modelo.
 */
import { usePathname, useRouter } from "next/navigation";

import { Grupo, Linha, Segmentado } from "@/components/ajustes";
import { useT } from "@/hooks/i18n/useT";
import type { PromptTemplate } from "@/lib/schemas/onboarding";
import { Check } from "@/lib/ui/icons";

export interface OpcaoDeModelo {
  id: string;
  comoSeApresenta: string;
  resumo: string;
}

export function EscolhaDeModelo({
  modelos,
  jeitos,
  modelo,
  tom,
}: {
  modelos: ReadonlyArray<OpcaoDeModelo>;
  jeitos: ReadonlyArray<{ id: PromptTemplate; titulo: string }>;
  modelo: string | null;
  tom: PromptTemplate;
}) {
  const t = useT();
  const router = useRouter();
  const caminho = usePathname();
  const endereco = (m: string, j: PromptTemplate) => `${caminho}?modelo=${m}&tom=${j}`;

  return (
    <div className="max-w-3xl space-y-3" data-testid="escolha-de-modelo">
      <Grupo
        titulo={t("Começar de um modelo")}
        rodape={t(
          "O modelo preenche as instruções, as capacidades e as palavras que chamam uma pessoa. Nada é salvo até você clicar em Criar agente, e tudo continua editável.",
        )}
      >
        {modelos.map((m) => (
          <Linha
            key={m.id}
            href={endereco(m.id, tom)}
            titulo={t(m.comoSeApresenta)}
            descricao={t(m.resumo)}
            testid={`modelo-${m.id}`}
            valor={m.id === modelo ? <Check size={16} className="text-success" aria-label={t("Em uso")} /> : undefined}
          />
        ))}
        <Linha
          href={caminho}
          titulo={t("Começar em branco")}
          testid="modelo-em-branco"
          valor={modelo === null ? <Check size={16} className="text-success" aria-label={t("Em uso")} /> : undefined}
        />
      </Grupo>

      {modelo !== null ? (
        <Segmentado<PromptTemplate>
          valor={tom}
          aoMudar={(j) => router.replace(endereco(modelo, j), { scroll: false })}
          rotuloAcessivel={t("Jeito de falar")}
          testid="modelo-tom"
          opcoes={jeitos.map((j) => ({ valor: j.id, rotulo: t(j.titulo), testid: `tom-${j.id}` }))}
        />
      ) : null}
    </div>
  );
}
