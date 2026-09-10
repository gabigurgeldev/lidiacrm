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

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

interface CaminhoDaDivisao {
  id: string;
  label: string;
}

const TETO_DE_CAMINHOS = 10;

/**
 * `logic.split` — "Dividir os caminhos".
 *
 * O campo que decide tudo é o **modo**, e a diferença entre dois deles não é
 * óbvia pelo nome: "em fila" e "igualando" parecem a mesma coisa e não são.
 * Por isso cada modo carrega uma frase de efeito, mostrada conforme o escolhido
 * — quem monta o fluxo precisa saber, ANTES de publicar, que só o igualitário
 * compensa uma saída acrescentada no meio do caminho.
 */
export function LogicSplitForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const caminhos = (Array.isArray(config.caminhos) ? config.caminhos : []) as CaminhoDaDivisao[];
  const modo = String(config.modo ?? "fila");

  const trocar = (novos: CaminhoDaDivisao[]) => aoMudarConfig({ ...config, caminhos: novos });

  const acrescentar = () => {
    // O id nasce uma vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear o caminho soltar a linha.
    trocar([...caminhos, { id: `d${Date.now().toString(36)}`, label: t("Novo caminho") }]);
  };

  const dicaDoModo =
    modo === "aleatorio"
      ? t(
          "Sorteio puro. Pode cair no mesmo caminho várias vezes seguidas — isso é o sorteio funcionando, não defeito.",
        )
      : modo === "igualitario"
        ? t(
            "Olha quantas vezes cada caminho já saiu e manda para o que está atrás. Caminho acrescentado depois recebe mais até empatar.",
          )
        : t(
            "Gira na ordem dos caminhos abaixo: um, o outro, e volta ao primeiro. Não olha o passado — só a ordem.",
          );

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("Como dividir")}>
        <Campo rotulo={t("Modo de distribuição")}>
          <Select value={modo} onValueChange={(v) => aoMudarConfig({ ...config, modo: v })}>
            <SelectTrigger data-testid="campo-modo-da-divisao">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fila">{t("Em fila, na ordem")}</SelectItem>
              <SelectItem value="igualitario">{t("Igualando o total de cada caminho")}</SelectItem>
              <SelectItem value="aleatorio">{t("Sorteando")}</SelectItem>
            </SelectContent>
          </Select>
          <Dica texto={dicaDoModo} />
        </Campo>
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Os caminhos")}
        </p>
        <p className="px-1 text-xs text-muted-foreground">
          {t("Cada caminho vira uma saída do bloco, e toda saída precisa ir a algum lugar.")}
        </p>
        {/*
          Um cartão por caminho, e NÃO um `.ios-grupo` por item: cartão agrupado
          por linha de lista é justamente o caso que o design system proíbe.
        */}
        {caminhos.map((caminho, i) => (
          <div
            key={caminho.id}
            className="rounded-md border p-3"
            data-testid={`caminho-${caminho.id}`}
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Nome deste caminho")}</label>
              <Input
                value={caminho.label}
                maxLength={60}
                onChange={(e) => {
                  const novos = [...caminhos];
                  novos[i] = { ...caminho, label: e.target.value };
                  trocar(novos);
                }}
                data-testid={`rotulo-do-caminho-${caminho.id}`}
              />
            </div>
            {/*
              Dois é o piso do schema. Sem esta guarda o botão apagaria até
              sobrar um, e o bloco ficaria sem desenhar saída nenhuma — a
              pessoa veria o cartão perder as linhas sem nada dizer por quê.
            */}
            {caminhos.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => trocar(caminhos.filter((c) => c.id !== caminho.id))}
                data-testid={`apagar-caminho-${caminho.id}`}
              >
                {t("Remover este caminho")}
              </Button>
            )}
          </div>
        ))}

        {caminhos.length < TETO_DE_CAMINHOS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={acrescentar}
            data-testid="add-caminho"
          >
            {t("Acrescentar caminho")}
          </Button>
        )}
      </div>
    </div>
  );
}
