"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import type { FlowBranch } from "@/lib/flow-engine/types";

import { Campo, Dica, Secao } from "./forms/shared";

interface Props {
  /** O nome do bloco de onde a linha sai. */
  origem: string;
  /** O nome do bloco onde a linha chega. */
  destino: string;
  /** As saídas do bloco de origem — a linha representa UMA delas. */
  ramosDaOrigem: readonly FlowBranch[];
  /** A saída que esta linha representa hoje. */
  ramoAtual: string;
  /** Saídas da origem que JÁ têm outra linha — não podem ser escolhidas. */
  ramosOcupados: readonly string[];
  aoTrocarRamo: (ramo: string) => void;
  aoApagar: () => void;
}

/**
 * As saídas que ESTA linha pode passar a representar.
 *
 * Função pura, exportada, e testada direto: a regra é lógica, não marcação, e
 * medi-la abrindo o dropdown mediria o jsdom (o Radix Select não abre nele —
 * `target.hasPointerCapture is not a function`), não o produto. Mesma decisão
 * que `PainelDoNo.paralelo.test.tsx` já documenta.
 *
 * A saída ATUAL entra sempre, mesmo constando como ocupada: quem a ocupa é esta
 * própria linha, e escondê-la deixaria o campo mostrando um valor fora da
 * lista — que o Select desenha como caixa vazia.
 */
export function ramosOferecidos(
  ramosDaOrigem: readonly FlowBranch[],
  ramoAtual: string,
  ramosOcupados: readonly string[],
): FlowBranch[] {
  const ocupados = new Set(ramosOcupados);
  return ramosDaOrigem.filter((r) => r.id === ramoAtual || !ocupados.has(r.id));
}

/**
 * Os ajustes de uma LINHA.
 *
 * ## Por que uma linha precisa de painel
 *
 * Até aqui, a única forma de mudar de qual saída uma linha parte era arrastar
 * de novo, mirando a bolinha certa — e as bolinhas são do tamanho de um ponto,
 * empilhadas, uma por saída. Quem monta um fluxo pela primeira vez não descobre
 * sozinho que a bolinha é o que importa; descobre que "a linha foi para o lugar
 * errado" e não descobre como consertar.
 *
 * O painel diz, em português, o que a linha está fazendo ("de tal bloco, pela
 * saída tal, para tal bloco") e deixa trocar a saída por uma lista. É a mesma
 * ideia do `EdgeConfigPanel.tsx` do construtor de follow-up, que já existia.
 *
 * ## Por que só as saídas LIVRES entram na lista
 *
 * Uma saída leva a um destino só — `aoLigar` no canvas já apaga a linha antiga
 * quando alguém liga uma segunda na mesma bolinha. Se a lista aqui oferecesse
 * saídas ocupadas, escolher uma delas apagaria em silêncio a linha da outra:
 * a pessoa mexe numa linha e perde outra, sem nada acusar.
 */
export function EdgeConfigPanel({
  origem,
  destino,
  ramosDaOrigem,
  ramoAtual,
  ramosOcupados,
  aoTrocarRamo,
  aoApagar,
}: Props) {
  const t = useT();
  const disponiveis = ramosOferecidos(ramosDaOrigem, ramoAtual, ramosOcupados);

  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-background p-4"
      data-testid="painel-da-aresta"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("Esta ligação")}</p>
        <p className="text-xs leading-snug text-muted-foreground" data-testid="resumo-da-aresta">
          {t("De")} <span className="font-medium text-foreground">{origem}</span> {t("para")}{" "}
          <span className="font-medium text-foreground">{destino}</span>
        </p>
      </div>

      <Secao>
        <Campo rotulo={t("Sai por qual saída")}>
          {disponiveis.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="sem-ramo-disponivel">
              {t("Este bloco tem uma saída só.")}
            </p>
          ) : (
            <Select value={ramoAtual} onValueChange={aoTrocarRamo}>
              <SelectTrigger data-testid="campo-ramo-da-aresta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {disponiveis.map((ramo) => (
                  <SelectItem key={ramo.id} value={ramo.id}>
                    {t(ramo.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dica
            texto={t(
              "As saídas que já têm outra linha não aparecem aqui — cada saída leva a um bloco só.",
            )}
          />
        </Campo>
      </Secao>

      <Button
        variant="outline"
        size="sm"
        className="mt-auto"
        onClick={aoApagar}
        data-testid="apagar-aresta"
      >
        {t("Remover esta ligação")}
      </Button>
    </aside>
  );
}
