"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { Trash } from "@/lib/ui/icons";

import { NodeConfigPanel } from "./NodeConfigPanel";
import type { BlocoAlcancavel, FluxoChamavel } from "./forms/shared";

export type { BlocoAlcancavel, FluxoChamavel };

/**
 * A casca do painel de um bloco: o nome, os ajustes, o botão de remover.
 *
 * Já foi um arquivo de 759 linhas com um `switch` de dezesseis casos dentro.
 * Hoje os ajustes de cada bloco moram em `forms/`, um arquivo por bloco, e o
 * índice é `nodeFormRegistry.ts` — ver o cabeçalho de lá para o porquê.
 */
interface Props {
  tipo: string;
  categoria: string;
  rotulo: string;
  config: Record<string, unknown>;
  aoMudarRotulo: (rotulo: string) => void;
  aoMudarConfig: (config: Record<string, unknown>) => void;
  /**
   * Remove este bloco.
   *
   * O painel NÃO decide se a remoção pode: ele sempre oferece o botão, e quem
   * conhece o grafo — o `FlowCanvas` — decide se o gesto pede confirmação. Havia
   * aqui uma prop `podeApagar`, e no bloco de início ela não desabilitava o
   * botão: **removia-o do DOM**, sem tooltip e sem uma linha de motivo. A trava
   * não protegia nada que a publicação não protegesse melhor (ela recusa fluxo
   * sem gatilho, ancorado no quadro) e cobrava o preço de um bloco que não sai.
   */
  aoApagar: () => void;
  /**
   * Cria uma cópia deste bloco, com a MESMA config, ao lado.
   *
   * Fica aqui e não num menu do cartão porque é onde a pessoa está quando
   * acabou de configurar — o gesto que se quer é "mais um desses, igual".
   * Gatilho não duplica; ver o porquê em `duplicar`, no FlowCanvas. Duplicar e
   * apagar divergem de propósito no gatilho: um segundo bloco de início é um
   * grafo que a publicação recusa (`gatilho_repetido`), enquanto NENHUM é um
   * rascunho legítimo, que se completa pegando outro na paleta.
   */
  aoDuplicar?: () => void;
  /**
   * Os blocos de reencontro DESTE fluxo.
   *
   * ⚠️ Sem isto o campo era texto livre pedindo o `id` do bloco — e a pessoa vê
   * "Reencontro" no quadro, não `junta`. Ela teria de descobrir um identificador
   * que a tela nunca mostra, para um campo sem o qual o fluxo não publica.
   */
  blocosDeReencontro?: readonly BlocoAlcancavel[];
  /** Os fluxos da organização, para o bloco "Chamar outro fluxo". */
  fluxosChamaveis?: readonly FluxoChamavel[];
}

export function PainelDoNo(props: Props) {
  const t = useT();

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l bg-background"
      data-testid="painel-do-no"
    >
      {/*
       * `min-h-0` é obrigatório: sem ele o filho flex não encolhe, a rolagem
       * não aparece, o conteúdo estica o <aside> e o rodapé desce junto — que
       * é exatamente o defeito que esta divisão existe para consertar.
       */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <Label htmlFor="rotulo-do-no">{t("Nome deste bloco")}</Label>
          <Input
            id="rotulo-do-no"
            value={props.rotulo}
            maxLength={80}
            onChange={(e) => props.aoMudarRotulo(e.target.value)}
            data-testid="campo-rotulo-do-no"
          />
          <p className="text-xs text-muted-foreground">
            {t("É só o nome que aparece no quadro. Mudar não desliga nenhuma ligação.")}
          </p>
        </div>

        <NodeConfigPanel
          tipo={props.tipo}
          categoria={props.categoria}
          config={props.config}
          aoMudarConfig={props.aoMudarConfig}
          blocosDeReencontro={props.blocosDeReencontro}
          fluxosChamaveis={props.fluxosChamaveis}
        />
      </div>

      {/*
       * O rodapé é IRMÃO da área que rola, nunca filho dela. Antes estes botões
       * tinham `mt-auto` DENTRO do container rolável: em bloco de formulário
       * longo (a decisão com várias saídas, o aviso no WhatsApp com textarea de
       * 6 linhas) eles desciam com o conteúdo e ficavam abaixo da dobra — e
       * ninguém rola um painel que parece terminado. Era o "não consigo apagar
       * alguns blocos".
       */}
      <div className="flex shrink-0 flex-col gap-2 border-t p-4">
        {props.categoria !== "trigger" && props.aoDuplicar !== undefined && (
          <Button
            variant="outline"
            size="sm"
            onClick={props.aoDuplicar}
            data-testid="duplicar-no"
          >
            {t("Duplicar com estes ajustes")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={props.aoApagar}
          data-testid="apagar-no"
        >
          <Trash size={14} aria-hidden className="mr-1" />
          {t("Remover este bloco")}
        </Button>
      </div>
    </aside>
  );
}
