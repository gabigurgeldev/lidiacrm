"use client";

import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";

import type { EscolhaDeProfissionais } from "./profissionais-na-tela";
import type { Pessoa } from "./tipos";

const QUALQUER = "";

/**
 * QUEM VAI ATENDER — "qualquer habilitada" ou uma escolhida, e duas quando o tipo
 * pede duas.
 *
 * "Qualquer" é o padrão, e não por preguiça: é a pergunta que a recepção faz na
 * maioria das vezes ("tem horário amanhã?"), e o horário mostra QUEM atende
 * logo abaixo dele — escolher antes só é preciso quando a cliente tem
 * preferência. Forçar a escolha primeiro faria a pessoa clicar em cada
 * profissional para descobrir quem tem vaga.
 *
 * Só aparecem as HABILITADAS no tipo: oferecer quem não faz aquele serviço
 * produziria um 422 `agenda_profissional_invalido` depois do clique, em vez de
 * simplesmente não oferecer.
 *
 * `<select>` nativo, e não o Radix: são duas listas curtas dentro de um Sheet, e
 * o nativo abre com o teclado do celular e não disputa foco com o Sheet.
 */
export function SeletorDeProfissionais({
  habilitadas,
  necessarias,
  valor,
  onChange,
}: {
  habilitadas: Pessoa[];
  necessarias: 1 | 2;
  valor: EscolhaDeProfissionais;
  onChange: (proxima: EscolhaDeProfissionais) => void;
}) {
  const t = useT();
  const classe =
    "h-9 w-full rounded-md border border-border bg-surface-elevated px-2 text-sm text-text outline-none focus:border-border-strong";

  if (habilitadas.length === 0) {
    return (
      // O aviso É A PORTA: instrução sem caminho é acusação.
      <p data-testid="sem-profissional-habilitada" className="text-xs leading-4 text-warning">
        {t("Nenhuma profissional habilitada neste tipo.")}{" "}
        <Link
          href="/app/settings/tenant/agenda"
          className="font-medium underline underline-offset-2 hover:text-text"
        >
          {t("Habilitar quem atende")}
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="seletor-de-profissionais" data-necessarias={necessarias}>
      <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
        {necessarias === 2 ? t("Quem atende") : t("Profissional")}
        <select
          data-testid="escolha-principal"
          value={valor.principalId ?? QUALQUER}
          onChange={(e) => {
            const principalId = e.target.value || null;
            // A mesma pessoa não pode ser as duas — a rota recusa ids repetidos.
            onChange({ principalId, apoioId: valor.apoioId === principalId ? null : valor.apoioId });
          }}
          className={classe}
        >
          <option value={QUALQUER}>{t("Qualquer habilitada")}</option>
          {habilitadas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      {necessarias === 2 ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          {t("Apoio")}
          <select
            data-testid="escolha-apoio"
            value={valor.apoioId ?? QUALQUER}
            onChange={(e) => onChange({ principalId: valor.principalId, apoioId: e.target.value || null })}
            className={classe}
          >
            <option value={QUALQUER}>{t("Qualquer habilitada")}</option>
            {habilitadas
              .filter((p) => p.id !== valor.principalId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {necessarias === 2 ? (
        <p className="text-[11px] leading-4 text-text-subtle">
          {t("Este serviço pede duas pessoas: só aparecem os horários em que as duas estão livres.")}
        </p>
      ) : null}
    </div>
  );
}
