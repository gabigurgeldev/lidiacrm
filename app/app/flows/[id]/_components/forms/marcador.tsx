"use client";

import { useMarcadores } from "@/hooks/flows/useMarcadores";
import { useT } from "@/hooks/i18n/useT";

/**
 * Os marcadores JÁ USADOS na operação, como botões.
 *
 * Existe porque marcar e perguntar são dois campos de texto livre, e `vip`
 * contra `VIP` produz um fluxo que decide errado sem erro em lugar nenhum —
 * `condicoes.ts` compara pertinência em array sem normalizar caixa. Clicar num
 * marcador que já existe é o caminho mais curto para os dois lados baterem.
 *
 * Não substitui o campo: marcador novo se digita, e o campo aceita variável
 * (`{{...}}`). Isto é sugestão, não vocabulário fechado.
 */
export function SugestoesDeMarcador({
  aoEscolher,
  atual,
}: {
  aoEscolher: (tag: string) => void;
  atual?: string;
}) {
  const t = useT();
  const { data } = useMarcadores();
  const marcadores = (data ?? []).slice(0, 12);
  if (marcadores.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1" data-testid="sugestoes-de-marcador">
      <span className="self-center text-xs text-muted-foreground">{t("Já usados:")}</span>
      {marcadores.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => aoEscolher(tag)}
          aria-pressed={tag === atual}
          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
            tag === atual
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
          data-testid={`sugestao-${tag}`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
