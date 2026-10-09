"use client";
import { Grupo } from "@/components/ajustes";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { TokenCounter } from "@/lib/ui/TokenCounter";

import type { PropsDaSecao } from "./estado";
import { Bloco, ErroDoCampo } from "./pecas";

export function SecaoInstrucoes({
  form,
  patch,
  disabled,
  erros,
  janelaDeContexto,
}: PropsDaSecao & { janelaDeContexto: number | null }) {
  const t = useT();
  const tamanho = form.system_prompt.trim().length;
  return (
    <Grupo
      titulo={t("As instruções dele")}
      rodape={t("Como ele deve falar, o que pode prometer e o que nunca deve dizer. Ele lê isto antes de toda resposta.")}
    >
      <Bloco>
        <div className="flex items-center justify-end gap-2">
          {/* O contador é o aviso que chega ANTES do erro: quem cola um texto
              grande vê na hora que ele não vai caber, em vez de descobrir
              depois — ou nunca. */}
          <span
            data-testid="contador-do-prompt"
            className={tamanho > 20000 ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          >
            {tamanho.toLocaleString("pt-BR")}/20.000
          </span>
          <TokenCounter text={form.system_prompt} contextWindow={janelaDeContexto} className="text-xs" />
        </div>
        <Textarea
          aria-label={t("As instruções dele")}
          value={form.system_prompt}
          onChange={(e) => patch({ system_prompt: e.target.value })}
          disabled={disabled}
          rows={14}
          /**
           * SEM `maxLength`, e é o conserto — não um esquecimento.
           *
           * O navegador aplica o atributo na COLAGEM, sem evento e sem aviso: o
           * que passa do limite não entra no campo. Cinco versões de um agente
           * em produção foram salvas com exatamente 19.999 caracteres, a última
           * cortada no meio de uma frase, e o aviso logo acima — "passaram de
           * 20.000" — era inalcançável, porque o estado nunca podia exceder o
           * teto que o atributo já impunha.
           *
           * Sem ele o texto inteiro entra, a validação dispara e o autor lê
           * quanto precisa cortar. Limite que recusa é honesto; limite que corta
           * em silêncio faz o autor publicar o que não escreveu.
           */
          spellCheck={false}
          className="font-mono text-xs"
          aria-invalid={!!erros.system_prompt}
        />
        <ErroDoCampo texto={erros.system_prompt} />
      </Bloco>
    </Grupo>
  );
}
