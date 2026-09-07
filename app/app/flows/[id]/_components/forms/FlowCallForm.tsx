"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `flow.call` — roda outro fluxo publicado e espera ele terminar. */
export function FlowCallForm({ config, aoMudarConfig, fluxosChamaveis }: PropsDoFormulario) {
  const t = useT();
  // ⚠️ Só os PUBLICADOS entram na lista. Um fluxo em rascunho não roda, e
  // oferecê-lo aqui produziria um bloco que publica e falha na primeira
  // execução — com a causa a dois cliques de distância de quem montou.
  const chamaveis = (fluxosChamaveis ?? []).filter((f) => f.publicado);

  return (
    <Secao>
      <Campo rotulo={t("Qual fluxo chamar")}>
        {chamaveis.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="sem-fluxo-chamavel">
            {t(
              "Nenhum outro fluxo publicado nesta organização. Publique o fluxo que você quer chamar primeiro.",
            )}
          </p>
        ) : (
          <Select
            value={String(config.fluxo_id ?? "")}
            onValueChange={(v) => aoMudarConfig({ ...config, fluxo_id: v })}
          >
            <SelectTrigger data-testid="campo-fluxo-chamado">
              <SelectValue placeholder={t("Escolha o fluxo")} />
            </SelectTrigger>
            <SelectContent>
              {chamaveis.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Dica texto={t("Ele roda inteiro, e este fluxo continua quando ele terminar.")} />
      </Campo>
    </Secao>
  );
}
