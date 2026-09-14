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
import {
  OPERADORES,
  operadorPedeValor,
  type Grupo,
  type Operador,
  type Regra,
} from "@/lib/flow-engine/condicoes";
import { lerMarcador, montarMarcador } from "@/lib/flow-engine/regra-de-marcador";

import { CampoComVariavel } from "./CampoComVariavel";
import { SugestoesDeMarcador } from "./marcador";
import type { PropsDoFormulario } from "./shared";

/** Os tipos são os do avaliador — nunca uma cópia local: duas formas do mesmo
 *  grafo divergiriam na primeira mudança de `condicoes.ts`. */
type Item = Regra | Grupo;

interface Saida {
  id: string;
  label: string;
  quando: Grupo;
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
 * Os operadores em que o valor é NÚMERO de verdade.
 *
 * A versão anterior convertia todo valor que parecesse número, em qualquer
 * operador — e isso estragava marcador chamado `2024`, que virava o número
 * 2024 e deixava de casar com a string da coluna. Para os demais operadores a
 * conversão nunca foi necessária: `ordena()` já compara numericamente quando os
 * dois lados são numéricos, então `eq 70` continua funcionando com "70" no
 * grafo.
 */
const OPERADOR_NUMERICO: ReadonlySet<Operador> = new Set(["gt", "gte", "lt", "lte", "between"]);

function ehGrupo(item: Item): item is Grupo {
  return typeof item === "object" && item !== null && "itens" in item;
}

const regraNova = (): Regra => ({ campo: "lead.score", op: "gt", valor: 70 });

/**
 * `logic.if` — "Decidir".
 *
 * O único bloco com forma variável: cada saída é uma pergunta, e a primeira que
 * for verdade vence. É por isso que ele cobre tanto o "se/senão" quanto o
 * "escolha entre vários" — a mesma pergunta com mais respostas.
 *
 * ## As duas formas de escrever uma condição
 *
 * `Tem o marcador` é a pergunta pronta: por baixo ela vira um grupo `or` com
 * `lead.tags` E `contact.tags` (`lib/flow-engine/regra-de-marcador.ts`), porque
 * o marcador mora num ou no outro conforme o fluxo tenha lead. Escrever isso à
 * mão pedia entender a regra de ausência do avaliador, e quem errava não via
 * erro nenhum — a condição só devolvia falso para sempre.
 *
 * `Campo` é o editor cru de antes, para score, valor, origem e afins.
 *
 * ## Por que agora dá para ter mais de uma regra por saída
 *
 * Porque antes não dava: a saída nascia com UMA regra e não havia botão de
 * acrescentar nem de remover, e o `combinador` (E/OU) existia no schema sem
 * nenhum lugar na tela onde escolhê-lo. Uma pergunta com duas partes era
 * impossível de escrever pela tela — e o schema sempre aceitou.
 *
 * Não usa `Secao`/`.ios-grupo`: a tela dele É uma lista que cresce, e cartão
 * agrupado por item de lista é o caso que o design system proíbe.
 */
export function LogicIfForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const saidas = (Array.isArray(config.saidas) ? config.saidas : []) as Saida[];

  const trocar = (novas: Saida[]) => aoMudarConfig({ ...config, saidas: novas });

  const trocarItens = (i: number, itens: Item[]) => {
    const saida = saidas[i];
    if (saida === undefined) return;
    const novas = [...saidas];
    novas[i] = { ...saida, quando: { ...saida.quando, itens } };
    trocar(novas);
  };

  const acrescentar = () => {
    // O id é gerado UMA vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear a saída soltar a linha.
    const id = `s${Date.now().toString(36)}`;
    trocar([
      ...saidas,
      {
        id,
        label: t("Nova condição"),
        quando: { combinador: "and", itens: [regraNova()] },
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

          {saida.quando.itens.length > 1 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t("Combinar as regras com")}</span>
              <Select
                value={saida.quando.combinador}
                onValueChange={(v) => {
                  const novas = [...saidas];
                  novas[i] = {
                    ...saida,
                    quando: { ...saida.quando, combinador: v as "and" | "or" },
                  };
                  trocar(novas);
                }}
              >
                <SelectTrigger className="w-28" data-testid={`combinador-${saida.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">{t("E (todas)")}</SelectItem>
                  <SelectItem value="or">{t("OU (qualquer uma)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {saida.quando.itens.map((item, j) => {
            const marcador = lerMarcador(item);
            const trocarItem = (novo: Item) => {
              const itens = [...saida.quando.itens];
              itens[j] = novo;
              trocarItens(i, itens);
            };

            return (
              <div key={j} className="mt-2 flex flex-col gap-1.5 border-t pt-2">
                <div className="flex gap-1.5">
                  <Select
                    value={marcador === null ? "campo" : "marcador"}
                    onValueChange={(v) =>
                      trocarItem(
                        v === "marcador" ? montarMarcador({ tag: "", tem: true }) : regraNova(),
                      )
                    }
                  >
                    <SelectTrigger className="w-40" data-testid={`modo-${saida.id}-${j}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="marcador">{t("Tem o marcador")}</SelectItem>
                      <SelectItem value="campo">{t("Campo do cliente")}</SelectItem>
                    </SelectContent>
                  </Select>

                  {saida.quando.itens.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        trocarItens(
                          i,
                          saida.quando.itens.filter((_, k) => k !== j),
                        )
                      }
                      data-testid={`remover-regra-${saida.id}-${j}`}
                    >
                      {t("Remover regra")}
                    </Button>
                  )}
                </div>

                {marcador !== null ? (
                  <>
                    <div className="flex gap-1.5">
                      <Select
                        value={marcador.tem ? "tem" : "nao_tem"}
                        onValueChange={(v) =>
                          trocarItem(montarMarcador({ tag: marcador.tag, tem: v === "tem" }))
                        }
                      >
                        <SelectTrigger
                          className="w-36"
                          data-testid={`marcador-tem-${saida.id}-${j}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tem">{t("Está marcado com")}</SelectItem>
                          <SelectItem value="nao_tem">{t("NÃO está marcado com")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={marcador.tag}
                        maxLength={40}
                        placeholder="vip"
                        onChange={(e) =>
                          trocarItem(montarMarcador({ tag: e.target.value, tem: marcador.tem }))
                        }
                        data-testid={`marcador-tag-${saida.id}-${j}`}
                      />
                    </div>
                    <SugestoesDeMarcador
                      atual={marcador.tag}
                      aoEscolher={(tag) => trocarItem(montarMarcador({ tag, tem: marcador.tem }))}
                    />
                    {marcador.tag.trim() === "" && (
                      // Marcador em branco publica e nunca casa — a condição só
                      // devolve falso, e o fluxo segue pelo outro lado para
                      // sempre. Dizer aqui é mais barato que descobrir depois
                      // na trilha de uma execução.
                      <p
                        className="text-xs text-destructive"
                        data-testid={`marcador-vazio-${saida.id}-${j}`}
                      >
                        {t("Falta escrever o marcador — em branco, esta condição nunca é verdade.")}
                      </p>
                    )}
                  </>
                ) : ehGrupo(item) ? (
                  // Grupo que não é a pergunta de marcador — veio da IA ou de um
                  // grafo escrito à mão. A tela não o desmonta: editar por cima
                  // com um formulário que não entende a forma apagaria regra.
                  <p className="text-xs text-muted-foreground" data-testid={`grupo-cru-${saida.id}-${j}`}>
                    {t("Condição composta, montada fora desta tela. Remova e refaça para editar.")}
                  </p>
                ) : (
                  <>
                    {/*
                      MODO `caminho`: aqui o texto NÃO é interpolado. `condicoes.ts`
                      RESOLVE `lead.score` como caminho, e um `{{lead.score}}` posto
                      aqui não daria erro nenhum — a condição simplesmente devolveria
                      falso, e o fluxo seguiria pelo outro lado para sempre.
                    */}
                    <CampoComVariavel
                      modo="caminho"
                      valor={item.campo}
                      placeholder="lead.score"
                      aoMudar={(v) => trocarItem({ ...item, campo: v })}
                      testid={`campo-da-regra-${saida.id}-${j}`}
                    />
                    <div className="flex gap-1.5">
                      <Select
                        value={item.op}
                        onValueChange={(v) => trocarItem({ ...item, op: v as Operador })}
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
                      {operadorPedeValor(item.op) && (
                        <Input
                          value={String(item.valor ?? "")}
                          onChange={(e) => {
                            const cru = e.target.value;
                            const numero = Number(cru);
                            trocarItem({
                              ...item,
                              // Número só onde o operador É numérico. Ver
                              // `OPERADOR_NUMERICO`: converter sempre estragava
                              // marcador chamado `2024`.
                              valor:
                                OPERADOR_NUMERICO.has(item.op) &&
                                cru.trim() !== "" &&
                                Number.isFinite(numero)
                                  ? numero
                                  : cru,
                            });
                          }}
                          data-testid={`valor-${saida.id}-${j}`}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div className="mt-2 flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => trocarItens(i, [...saida.quando.itens, regraNova()])}
              data-testid={`acrescentar-regra-${saida.id}`}
            >
              {t("Acrescentar regra")}
            </Button>
            {saidas.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => trocar(saidas.filter((s) => s.id !== saida.id))}
                data-testid={`remover-saida-${saida.id}`}
              >
                {t("Remover esta saída")}
              </Button>
            )}
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={acrescentar} data-testid="acrescentar-saida">
        {t("Acrescentar saída")}
      </Button>
    </div>
  );
}
