"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

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
  aoApagar: () => void;
  /**
   * Cria uma cópia deste bloco, com a MESMA config, ao lado.
   *
   * Fica aqui e não num menu do cartão porque é onde a pessoa está quando
   * acabou de configurar — o gesto que se quer é "mais um desses, igual".
   * Gatilho não duplica; ver o porquê em `duplicar`, no FlowCanvas.
   */
  aoDuplicar?: () => void;
  podeApagar: boolean;
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
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-background p-4"
      data-testid="painel-do-no"
    >
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

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {props.podeApagar && props.aoDuplicar !== undefined && (
          <Button
            variant="outline"
            size="sm"
            onClick={props.aoDuplicar}
            data-testid="duplicar-no"
          >
            {t("Duplicar com estes ajustes")}
          </Button>
        )}
        {props.podeApagar && (
          <Button variant="outline" size="sm" onClick={props.aoApagar} data-testid="apagar-no">
            {t("Remover este bloco")}
          </Button>
        )}
      </div>
    </aside>
  );
}
