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

interface Opcao {
  id: string;
  label: string;
  aceita: string[];
}

/**
 * `logic.choice_menu` — esperar uma escolha.
 *
 * ## O que este formulário precisa deixar claro, e por quê
 *
 * Que este bloco NÃO manda a pergunta. Ele só espera a resposta. Quem pergunta
 * é o bloco de envio antes dele — e essa separação é o que permite a pergunta
 * ser texto, imagem ou modelo aprovado sem este bloco saber nada de canal.
 *
 * Sem esse aviso, o modo de falha é previsível e mudo: a pessoa monta só o menu,
 * publica, e o fluxo fica esperando resposta de uma pergunta que nunca foi feita.
 */
export function LogicChoiceMenuForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const opcoes = Array.isArray(config.opcoes) ? (config.opcoes as Opcao[]) : [];
  const horas = Math.round(Number(config.prazo_ms ?? 3_600_000) / 3_600_000);

  const trocar = (novas: Opcao[]) => mudar({ opcoes: novas });

  const acrescentar = () => {
    // O id nasce uma vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear a opção soltar a linha.
    const id = `o${Date.now().toString(36)}`;
    trocar([...opcoes, { id, label: t("Nova opção"), aceita: [String(opcoes.length + 1)] }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Secao>
        <Campo rotulo={t("Como funciona")}>
          <p className="text-xs leading-snug text-muted-foreground">
            {t(
              "Este bloco só ESPERA a resposta. A pergunta com as opções sai de um bloco de mensagem antes dele.",
            )}
          </p>
        </Campo>
        <Campo rotulo={t("Esperar por quantas horas?")}>
          <Input
            type="number"
            min={1}
            max={720}
            value={horas}
            onChange={(e) =>
              mudar({ prazo_ms: Math.min(720, Math.max(1, Number(e.target.value))) * 3_600_000 })
            }
            data-testid="campo-prazo-do-menu"
          />
          <Dica
            texto={t(
              "Vencido o prazo, o fluxo segue pela saída 'Não respondeu a tempo' — que é diferente de 'Não entendi a resposta'.",
            )}
          />
        </Campo>
        <Campo rotulo={t("Como comparar a resposta")}>
          <Select value={String(config.modo ?? "exata")} onValueChange={(v) => mudar({ modo: v })}>
            <SelectTrigger data-testid="campo-modo-do-menu">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exata">{t("A resposta é exatamente uma das opções")}</SelectItem>
              <SelectItem value="contem">{t("A resposta contém uma das opções")}</SelectItem>
            </SelectContent>
          </Select>
          <Dica
            texto={t(
              "'Exata' é o certo para menu por número: com 'contém', a resposta '10' escolheria a opção '1'.",
            )}
          />
        </Campo>
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("As opções")}
        </p>
        {opcoes.map((opcao, i) => (
          <div key={opcao.id} className="rounded-md border p-3" data-testid={`opcao-${opcao.id}`}>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Nome desta saída")}</label>
              <Input
                value={opcao.label}
                maxLength={60}
                onChange={(e) => {
                  const novas = [...opcoes];
                  novas[i] = { ...opcao, label: e.target.value };
                  trocar(novas);
                }}
                data-testid={`rotulo-da-opcao-${opcao.id}`}
              />
            </div>
            <div className="mt-2 space-y-1.5">
              <label className="text-sm font-medium">{t("O cliente pode responder")}</label>
              <Input
                value={opcao.aceita.join(", ")}
                placeholder={t("1, sim, quero")}
                onChange={(e) => {
                  const novas = [...opcoes];
                  novas[i] = {
                    ...opcao,
                    aceita: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter((x) => x !== ""),
                  };
                  trocar(novas);
                }}
                data-testid={`aceita-da-opcao-${opcao.id}`}
              />
            </div>
            {opcoes.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => trocar(opcoes.filter((o) => o.id !== opcao.id))}
                data-testid={`remover-opcao-${opcao.id}`}
              >
                {t("Remover esta opção")}
              </Button>
            )}
          </div>
        ))}

        {opcoes.length < 10 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={acrescentar}
            data-testid="acrescentar-opcao"
          >
            {t("Acrescentar opção")}
          </Button>
        )}
      </div>
    </div>
  );
}
