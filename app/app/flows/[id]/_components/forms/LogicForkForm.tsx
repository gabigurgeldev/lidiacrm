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

interface RamoDoFork {
  id: string;
  label: string;
}

/**
 * `logic.fork` — "Fazer ao mesmo tempo".
 *
 * O campo que parece burocracia e não é: **o reencontro**. Ele é declarado, e
 * não descoberto pelo sistema, porque adivinhar onde os caminhos se juntam
 * acerta no desenho simples e erra em silêncio assim que houver duas
 * bifurcações uma dentro da outra — e errar em silêncio aqui significa um fluxo
 * que se junta no lugar errado sem nada acusar.
 */
export function LogicForkForm({
  config,
  aoMudarConfig,
  blocosDeReencontro,
}: PropsDoFormulario) {
  const t = useT();
  const ramos = (Array.isArray(config.ramos) ? config.ramos : []) as RamoDoFork[];
  const alvos = blocosDeReencontro ?? [];

  const trocar = (novos: RamoDoFork[]) => aoMudarConfig({ ...config, ramos: novos });

  const acrescentar = () => {
    // O id nasce uma vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear o caminho soltar a linha.
    trocar([...ramos, { id: `c${Date.now().toString(36)}`, label: t("Novo caminho") }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("Como funciona")}>
        <Campo rotulo={t("Como os caminhos se juntam")}>
          <Select
            value={String(config.modo ?? "todas")}
            onValueChange={(v) => aoMudarConfig({ ...config, modo: v })}
          >
            <SelectTrigger data-testid="campo-modo-do-fork">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">{t("Esperar todos terminarem")}</SelectItem>
              <SelectItem value="primeira">{t("Seguir com o primeiro que terminar")}</SelectItem>
            </SelectContent>
          </Select>
          <Dica
            texto={
              String(config.modo ?? "todas") === "primeira"
                ? t("Quando o primeiro chegar, os outros caminhos são cancelados.")
                : t("O fluxo só continua depois que todos os caminhos chegarem ao reencontro.")
            }
          />
        </Campo>

        <Campo rotulo={t("Bloco de reencontro")}>
          {alvos.length === 0 ? (
            // O caso que o campo de texto escondia: não há para onde apontar
            // ainda. Dizer isso é melhor que oferecer uma caixa vazia onde a
            // pessoa digita um nome que não existe e só descobre ao publicar.
            <p className="text-xs text-muted-foreground" data-testid="sem-bloco-de-reencontro">
              {t(
                "Nenhum bloco de reencontro no fluxo ainda. Acrescente um pela paleta — é ele que junta os caminhos de volta.",
              )}
            </p>
          ) : (
            <Select
              value={String(config.encontro ?? "")}
              onValueChange={(v) => aoMudarConfig({ ...config, encontro: v })}
            >
              <SelectTrigger data-testid="campo-encontro-do-fork">
                <SelectValue placeholder={t("Escolha o bloco de reencontro")} />
              </SelectTrigger>
              <SelectContent>
                {alvos.map((bloco) => (
                  <SelectItem key={bloco.id} value={bloco.id}>
                    {bloco.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dica texto={t("Onde estes caminhos voltam a ser um só. Sem ele o fluxo não publica.")} />
        </Campo>
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Os caminhos")}
        </p>
        {/*
          Um cartão por caminho, e NÃO um `.ios-grupo` por item: cartão agrupado
          por linha de lista é justamente o caso que o design system proíbe.
        */}
        {ramos.map((ramo, i) => (
          <div key={ramo.id} className="rounded-md border p-3" data-testid={`ramo-${ramo.id}`}>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Nome deste caminho")}</label>
              <Input
                value={ramo.label}
                maxLength={60}
                onChange={(e) => {
                  const novos = [...ramos];
                  novos[i] = { ...ramo, label: e.target.value };
                  trocar(novos);
                }}
                data-testid={`rotulo-do-ramo-${ramo.id}`}
              />
            </div>
            {ramos.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => trocar(ramos.filter((r) => r.id !== ramo.id))}
                data-testid={`apagar-ramo-${ramo.id}`}
              >
                {t("Remover este caminho")}
              </Button>
            )}
          </div>
        ))}

        {ramos.length < 6 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={acrescentar}
            data-testid="add-ramo"
          >
            {t("Acrescentar caminho")}
          </Button>
        )}
      </div>
    </div>
  );
}
