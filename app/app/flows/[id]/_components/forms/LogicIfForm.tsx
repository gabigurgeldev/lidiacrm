"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { OPERADORES, operadorPedeValor, type Operador } from "@/lib/flow-engine/condicoes";

import type { PropsDoFormulario } from "./shared";

interface Saida {
  id: string;
  label: string;
  quando: {
    combinador: "and" | "or";
    itens: Array<{ campo: string; op: Operador; valor?: unknown }>;
  };
}

/** Português de operação para cada operador. Nunca o nome técnico. */
const NOME_DO_OPERADOR: Record<Operador, string> = {
  eq: "é igual a",
  neq: "é diferente de",
  gt: "é maior que",
  gte: "é maior ou igual a",
  lt: "é menor que",
  lte: "é menor ou igual a",
  contains: "contém",
  not_contains: "não contém",
  starts_with: "começa com",
  ends_with: "termina com",
  empty: "está em branco",
  not_empty: "está preenchido",
  in: "está na lista",
  not_in: "não está na lista",
  regex: "casa com o padrão",
  before: "é antes de",
  after: "é depois de",
  between: "está entre",
};

/**
 * `logic.if` — "Decidir".
 *
 * O único bloco com forma variável: cada saída é uma pergunta, e a primeira que
 * for verdade vence. É por isso que ele cobre tanto o "se/senão" quanto o
 * "escolha entre vários" — a mesma pergunta com mais respostas.
 *
 * Não usa `Secao`/`.ios-grupo`: a tela dele É uma lista que cresce, e cartão
 * agrupado por item de lista é o caso que o design system proíbe. Cada saída
 * ganha uma borda simples, como já era.
 */
export function LogicIfForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const saidas = (Array.isArray(config.saidas) ? config.saidas : []) as Saida[];

  const trocar = (novas: Saida[]) => aoMudarConfig({ ...config, saidas: novas });

  const acrescentar = () => {
    // O id é gerado UMA vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear a saída soltar a linha.
    const id = `s${Date.now().toString(36)}`;
    trocar([
      ...saidas,
      {
        id,
        label: t("Nova condição"),
        quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t(
          "A primeira condição verdadeira vence. O que não bater em nenhuma sai pelo 'Nenhuma delas'.",
        )}
      </p>

      {saidas.map((saida, i) => (
        <div key={saida.id} className="rounded-md border p-3" data-testid={`saida-${saida.id}`}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("Nome desta saída")}</label>
            <Input
              value={saida.label}
              maxLength={60}
              onChange={(e) => {
                const novas = [...saidas];
                novas[i] = { ...saida, label: e.target.value };
                trocar(novas);
              }}
              data-testid={`rotulo-da-saida-${saida.id}`}
            />
          </div>

          {saida.quando.itens.map((regra, j) => (
            <div key={j} className="mt-2 flex flex-col gap-1.5">
              <Input
                value={regra.campo}
                placeholder="lead.score"
                onChange={(e) => {
                  const novas = [...saidas];
                  const itens = [...saida.quando.itens];
                  itens[j] = { ...regra, campo: e.target.value };
                  novas[i] = { ...saida, quando: { ...saida.quando, itens } };
                  trocar(novas);
                }}
                data-testid={`campo-da-regra-${saida.id}-${j}`}
              />
              <div className="flex gap-1.5">
                <Select
                  value={regra.op}
                  onValueChange={(v) => {
                    const novas = [...saidas];
                    const itens = [...saida.quando.itens];
                    itens[j] = { ...regra, op: v as Operador };
                    novas[i] = { ...saida, quando: { ...saida.quando, itens } };
                    trocar(novas);
                  }}
                >
                  <SelectTrigger className="w-36" data-testid={`operador-${saida.id}-${j}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERADORES.map((op) => (
                      <SelectItem key={op} value={op}>
                        {t(NOME_DO_OPERADOR[op])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {operadorPedeValor(regra.op) && (
                  <Input
                    value={String(regra.valor ?? "")}
                    onChange={(e) => {
                      const novas = [...saidas];
                      const itens = [...saida.quando.itens];
                      const cru = e.target.value;
                      const numero = Number(cru);
                      itens[j] = {
                        ...regra,
                        // Número quando for número: "score > 70" comparado como
                        // texto faria "9" ser maior que "10".
                        valor: cru.trim() !== "" && Number.isFinite(numero) ? numero : cru,
                      };
                      novas[i] = { ...saida, quando: { ...saida.quando, itens } };
                      trocar(novas);
                    }}
                    data-testid={`valor-${saida.id}-${j}`}
                  />
                )}
              </div>
            </div>
          ))}

          {saidas.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => trocar(saidas.filter((s) => s.id !== saida.id))}
              data-testid={`remover-saida-${saida.id}`}
            >
              {t("Remover esta saída")}
            </Button>
          )}
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={acrescentar} data-testid="acrescentar-saida">
        {t("Acrescentar saída")}
      </Button>
    </div>
  );
}
