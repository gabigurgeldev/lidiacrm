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
import { useAttendants } from "@/hooks/team/useAttendants";

import { CorpoDoRodizio } from "./corpoDoRodizio";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `routing.fixed_order` — a "fila indiana".
 *
 * ## Por que a ordem é montada com nome, e nunca com identificador
 *
 * O campo guarda ids de usuário, mas o identificador de uma pessoa não aparece
 * em tela nenhuma do produto. Pedir para colar seria pedir algo impossível de
 * obter — o mesmo defeito que o `flow.call` já tinha antes de ganhar seletor, e
 * que o campo de lista fixa do disparo tinha antes do importador.
 *
 * ## Por que setas em vez de arrastar
 *
 * Não existe primitivo de arrastar-para-reordenar no design system, e inventar
 * um aqui significaria também resolver teclado e leitor de tela para uma lista
 * que quase sempre tem menos de dez itens. Duas setas resolvem, funcionam no
 * teclado por construção, e são testáveis sem simular ponteiro.
 */
export function RoutingFixedOrderForm(props: PropsDoFormulario) {
  const t = useT();
  const { config, aoMudarConfig } = props;
  const { data } = useAttendants();
  const equipe = data?.data ?? [];
  const ordem = Array.isArray(config.ordem) ? (config.ordem as string[]) : [];

  const nomeDe = (id: string) =>
    equipe.find((a) => a.user_id === id)?.name ??
    equipe.find((a) => a.user_id === id)?.email ??
    t("Pessoa que não está mais na equipe");

  const trocar = (nova: string[]) => aoMudarConfig({ ...config, ordem: nova });

  const mover = (i: number, passo: -1 | 1) => {
    const j = i + passo;
    if (j < 0 || j >= ordem.length) return;
    const nova = [...ordem];
    const a = nova[i];
    const b = nova[j];
    if (a === undefined || b === undefined) return;
    nova[i] = b;
    nova[j] = a;
    trocar(nova);
  };

  const disponiveis = equipe.filter((a) => !ordem.includes(a.user_id));

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("A ordem")}>
        <Campo rotulo={t("Quem atende, e em que ordem")}>
          {ordem.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="fila-vazia">
              {t("Ninguém na fila ainda. Acrescente as pessoas na ordem em que devem atender.")}
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5" data-testid="fila-da-ordem">
              {ordem.map((id, i) => (
                <li
                  key={`${id}-${i}`}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                  data-testid={`fila-item-${i}`}
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground">{i + 1}º</span>
                  <span className="min-w-0 flex-1 truncate">{nomeDe(id)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => mover(i, -1)}
                    aria-label={t("Subir na fila")}
                    data-testid={`subir-${i}`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === ordem.length - 1}
                    onClick={() => mover(i, 1)}
                    aria-label={t("Descer na fila")}
                    data-testid={`descer-${i}`}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => trocar(ordem.filter((_, k) => k !== i))}
                    aria-label={t("Tirar da fila")}
                    data-testid={`tirar-${i}`}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Dica
            texto={t(
              "Cada lead vai para o próximo da ordem, dando a volta no fim. Quem estiver indisponível na hora é pulado, e a vez dele não se perde.",
            )}
          />
        </Campo>

        {disponiveis.length > 0 && (
          <Campo rotulo={t("Acrescentar à fila")}>
            <Select value="" onValueChange={(v) => trocar([...ordem, v])}>
              <SelectTrigger data-testid="campo-acrescentar-na-fila">
                <SelectValue placeholder={t("Escolha quem entra na fila")} />
              </SelectTrigger>
              <SelectContent>
                {disponiveis.map((a) => (
                  <SelectItem key={a.user_id} value={a.user_id}>
                    {a.name ?? a.email ?? a.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        )}
      </Secao>

      <CorpoDoRodizio {...props} />
    </div>
  );
}
