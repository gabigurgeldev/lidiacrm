"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `logic.business_hours` — o expediente.
 *
 * ## Por que os dias são sete botões, e não uma lista de caixas
 *
 * A pergunta é "quais dias?", e a resposta é olhada de relance mil vezes depois
 * de escrita uma. Sete caixas empilhadas ocupam meia tela e obrigam a LER para
 * saber; sete botões numa linha desenham a semana, e "seg a sex" é uma forma
 * reconhecível antes de qualquer leitura.
 *
 * A ordem começa no domingo porque é o índice 0 do `Date`/`Intl` — a mesma
 * numeração que `lib/horario/janela-semanal.ts` grava. Renumerar aqui para
 * "semana começa na segunda" criaria uma tradução entre a tela e o motor, e é
 * nessa tradução que um dia vira outro.
 *
 * ## O horário é `type="time"`, não dois campos de número
 *
 * O navegador já tem seletor de hora, já valida `HH:MM` e já respeita o formato
 * local de quem olha. Dois `<input type=number>` reimplementariam isso pior, e o
 * schema recusa qualquer coisa fora de `HH:MM` — o erro apareceria só na hora de
 * publicar.
 */

/**
 * Domingo primeiro: é o índice 0 do `Intl`, e a tradução é onde um dia vira outro.
 *
 * TRÊS letras, e não uma. "S" seria a chave de segunda, sexta E sábado ao mesmo
 * tempo — e o dicionário deste repo é indexado pelo próprio texto em português,
 * então as três colidiriam numa entrada só e o espanhol sairia errado em duas
 * delas. "Seg"/"Sex"/"Sáb" são chaves distintas e continuam cabendo no botão.
 */
const DIAS_DA_SEMANA = [
  { valor: 0, curto: "Dom", nome: "domingo" },
  { valor: 1, curto: "Seg", nome: "segunda" },
  { valor: 2, curto: "Ter", nome: "terça" },
  { valor: 3, curto: "Qua", nome: "quarta" },
  { valor: 4, curto: "Qui", nome: "quinta" },
  { valor: 5, curto: "Sex", nome: "sexta" },
  { valor: 6, curto: "Sáb", nome: "sábado" },
] as const;

export function LogicBusinessHoursForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  const dias = Array.isArray(config.dias) ? (config.dias as number[]) : [1, 2, 3, 4, 5];
  const foraDoHorario = String(config.fora_do_horario ?? "desviar");

  const alternarDia = (valor: number) => {
    const proximo = dias.includes(valor)
      ? dias.filter((d) => d !== valor)
      : [...dias, valor].sort((a, b) => a - b);
    mudar({ dias: proximo });
  };

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("Quando estamos abertos")}>
        <Campo rotulo={t("Dias da semana")}>
          <div className="flex gap-1.5" data-testid="campo-dias-da-semana">
            {DIAS_DA_SEMANA.map((dia) => {
              const marcado = dias.includes(dia.valor);
              return (
                <button
                  key={dia.valor}
                  type="button"
                  onClick={() => alternarDia(dia.valor)}
                  aria-pressed={marcado}
                  aria-label={t(dia.nome)}
                  data-testid={`dia-${dia.valor}`}
                  className={`h-9 flex-1 rounded-md border text-xs font-medium transition-colors ${
                    marcado
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {t(dia.curto)}
                </button>
              );
            })}
          </div>
          {dias.length === 0 && (
            <Dica texto={t("Escolha ao menos um dia — sem nenhum, o fluxo não publica.")} />
          )}
        </Campo>

        <Campo rotulo={t("Das")}>
          <Input
            type="time"
            value={String(config.inicio ?? "08:00")}
            onChange={(e) => mudar({ inicio: e.target.value })}
            data-testid="campo-inicio-do-expediente"
          />
        </Campo>

        <Campo rotulo={t("Até")}>
          <Input
            type="time"
            value={String(config.fim ?? "18:00")}
            onChange={(e) => mudar({ fim: e.target.value })}
            data-testid="campo-fim-do-expediente"
          />
          <Dica
            texto={t(
              "Expediente que atravessa a meia-noite ainda não é suportado — o fim precisa ser depois do começo.",
            )}
          />
        </Campo>

        <Campo rotulo={t("Fuso horário")}>
          <Select
            value={String(config.fuso ?? "America/Sao_Paulo")}
            onValueChange={(v) => mudar({ fuso: v })}
          >
            <SelectTrigger data-testid="campo-fuso-do-expediente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUSOS_OFERECIDOS.map((f) => (
                <SelectItem key={f.codigo} value={f.codigo}>
                  {f.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dica
            texto={t(
              "O horário é conferido neste fuso, não no do servidor — é o que faz 08:00 significar 08:00 para quem atende.",
            )}
          />
        </Campo>
      </Secao>

      <Secao titulo={t("Quando chegar fora do horário")}>
        <Campo rotulo={t("O que fazer")}>
          <Select value={foraDoHorario} onValueChange={(v) => mudar({ fora_do_horario: v })}>
            <SelectTrigger data-testid="campo-fora-do-horario">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desviar">{t("Seguir pela saída 'Fora do horário'")}</SelectItem>
              <SelectItem value="esperar">{t("Segurar e retomar quando abrir")}</SelectItem>
            </SelectContent>
          </Select>
          <Dica
            texto={
              foraDoHorario === "esperar"
                ? t(
                    "A execução dorme e continua sozinha na abertura. Ninguém recebe nada de madrugada — nem um aviso de que está fechado.",
                  )
                : t(
                    "A execução segue AGORA pela outra saída. É por onde se responde 'atendemos das 8h às 18h' sem deixar a pessoa no vácuo.",
                  )
            }
          />
        </Campo>
      </Secao>
    </div>
  );
}
