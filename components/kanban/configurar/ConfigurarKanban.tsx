"use client";
import { useQueryClient } from "@tanstack/react-query";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";

import { CamposENomes, type PipelineRow } from "./CamposENomes";
import { StagesSection, ancoraDasEtapas } from "./ColunasDoKanban";
import { AgentMappingSection, ancoraDoMapeamento } from "./PassoDoAgente";

export type AbaDeConfiguracao = "colunas" | "campos";

/**
 * Configurar o Kanban DENTRO dele (2026-10-27).
 *
 * Até aqui isto morava numa página à parte, "Colunas dos Kanbans", e o dono do
 * produto a mandou embora: quem monta o Kanban está olhando o quadro, e ter de
 * sair dele para marcar a coluna de fechamento ou dizer ao agente onde pôr o
 * card era o caminho que ninguém achava. As seções vieram INTEIRAS — mesma
 * regra, mesmos testes (`ColunasDoKanban.test.tsx`, `PassoDoAgente.test.tsx`) —
 * só mudaram de casa.
 *
 * Colunas e passo do agente ficam na MESMA aba de propósito: um aponta para o
 * outro por âncora ("crie a coluna que falta", "desfaça o vínculo com o
 * assistente"), e em abas separadas o link levaria a lugar nenhum.
 *
 * Papel: o painel inteiro é manager+ (as rotas de coluna e de mapeamento
 * cobram isso). "Campos e nomes" é admin — `updatePipelineConfig` recusa o
 * resto, e a aba nem aparece para quem seria recusado.
 */
export function ConfigurarKanban({
  pipeline,
  aberto,
  aba,
  onAbaChange,
  onOpenChange,
  podeEditarCampos,
}: {
  pipeline: PipelineRow;
  aberto: boolean;
  aba: AbaDeConfiguracao;
  onAbaChange: (aba: AbaDeConfiguracao) => void;
  onOpenChange: (aberto: boolean) => void;
  podeEditarCampos: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();

  // O quadro lê colunas, papéis e campos do MESMO GET; fechar o painel relê,
  // para o que mudou aqui aparecer lá sem F5.
  function mudarAberto(v: boolean) {
    if (!v) void qc.invalidateQueries({ queryKey: ["board", pipeline.id] });
    onOpenChange(v);
  }

  return (
    <Sheet open={aberto} onOpenChange={mudarAberto}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        data-testid="configurar-kanban"
      >
        <SheetHeader className="ios-vidro border-b border-border px-6 py-4">
          <SheetTitle>
            {t("Configurar")} «{pipeline.name}»
          </SheetTitle>
          <SheetDescription>
            {t("Colunas, onde o cliente fecha ou desiste, e para onde o agente leva o card em cada passo.")}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={aba}
          onValueChange={(v) => onAbaChange(v as AbaDeConfiguracao)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-6 pt-4">
            <TabsList className="ios-segmentado">
              <TabsTrigger value="colunas" data-testid="aba-colunas">
                {t("Colunas e agente")}
              </TabsTrigger>
              {podeEditarCampos && (
                <TabsTrigger value="campos" data-testid="aba-campos">
                  {t("Campos e nomes")}
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="colunas" className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
            <div className="space-y-8">
              <StagesSection
                pipelineId={pipeline.id}
                ancoraMapeamento={ancoraDoMapeamento(pipeline.id)}
              />
              <div className="border-t border-border pt-6">
                <AgentMappingSection
                  pipelineId={pipeline.id}
                  ancoraEtapas={ancoraDasEtapas(pipeline.id)}
                />
              </div>
            </div>
          </TabsContent>

          {podeEditarCampos && (
            <TabsContent value="campos" className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
              <CamposENomes pipeline={pipeline} />
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
