"use client";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `trigger.webhook` — o endereço que um sistema de fora chama.
 *
 * ## Por que o endereço NÃO aparece antes de publicar
 *
 * Porque ele não existe antes. O token nasce na publicação, e de propósito: um
 * endereço vivo para um fluxo em rascunho é um webhook que responde e não faz
 * nada — falha muda, do lado de fora, onde ninguém deste produto olha.
 *
 * Dizer isso aqui é o que evita a pergunta "onde está a URL?" virar chamado.
 */
export function TriggerWebhookForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Nome deste gatilho")}>
        <Input
          value={String(config.nome ?? "")}
          maxLength={120}
          onChange={(e) => aoMudarConfig({ ...config, nome: e.target.value })}
          data-testid="campo-nome-do-gatilho-webhook"
        />
        <Dica
          texto={t("Só para você reconhecer este gatilho na lista de Webhooks. Não muda o endereço.")}
        />
      </Campo>
      <Campo rotulo={t("O endereço")}>
        <p className="text-xs leading-snug text-muted-foreground" data-testid="aviso-do-endereco">
          {t(
            "O endereço deste gatilho é criado quando você PUBLICA o fluxo, e aparece em Canais › Webhooks. Ele não muda quando você publica de novo — dá para colar no outro sistema uma vez só.",
          )}
        </p>
      </Campo>
    </Secao>
  );
}
