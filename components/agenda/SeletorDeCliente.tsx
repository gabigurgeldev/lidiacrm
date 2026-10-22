"use client";

import * as React from "react";

import { useContactList } from "@/hooks/contacts/useContactList";
import { useT } from "@/hooks/i18n/useT";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { MagnifyingGlass, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export interface ClienteEscolhido {
  id: string;
  nome: string;
  telefone: string | null;
}

/**
 * PARA QUEM é o agendamento — busca na base de contatos.
 *
 * Antes deste campo, marcar pela tela criava um compromisso SEM cliente: o
 * card dizia "Consulta" e não com quem, o lembrete da 0245 não tinha para quem
 * ir, e a timeline do lead nunca recebia a atividade. A IA sempre mandava o
 * contato; a equipe não tinha como.
 *
 * Reusa `useContactList` (a mesma busca da tela de Contatos, com o mesmo
 * debounce do seletor do composer) em vez de uma rota nova. Contato anonimizado
 * não aparece: marcar consulta para um titular que pediu para ser esquecido
 * seria recriar o vínculo que a LGPD desfez.
 *
 * Opcional de propósito: bloqueio de agenda e reunião interna não têm cliente.
 */
export function SeletorDeCliente({
  valor,
  onChange,
}: {
  valor: ClienteEscolhido | null;
  onChange: (cliente: ClienteEscolhido | null) => void;
}) {
  const t = useT();
  const [busca, setBusca] = React.useState("");
  const [atrasada, setAtrasada] = React.useState("");
  const [aberto, setAberto] = React.useState(false);

  React.useEffect(() => {
    const espera = setTimeout(() => setAtrasada(busca.trim()), 250);
    return () => clearTimeout(espera);
  }, [busca]);

  const lista = useContactList({ search: atrasada || undefined, limit: 8 });
  const contatos = (lista.data?.pages.flatMap((p) => p.data) ?? [])
    .filter((c) => !c.is_anonymized)
    .slice(0, 8);

  if (valor) {
    return (
      <div
        data-testid="cliente-escolhido"
        className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{valor.nome}</p>
          {valor.telefone ? (
            <p className="truncate text-[11px] tabular-nums text-text-subtle">{phoneForDisplay(valor.telefone)}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={t("Trocar cliente")}
          data-testid="trocar-cliente"
          onClick={() => onChange(null)}
          className="shrink-0 rounded-sm p-1 text-text-muted hover:bg-surface hover:text-text"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" data-testid="seletor-de-cliente">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2 focus-within:border-border-strong">
        <MagnifyingGlass size={14} className="shrink-0 text-text-subtle" aria-hidden />
        <input
          data-testid="busca-de-cliente"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          // O atraso deixa o clique na opção acontecer antes de a lista sumir.
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          placeholder={t("Buscar cliente por nome ou telefone")}
          aria-label={t("Cliente")}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle"
        />
      </div>
      {aberto ? (
        <ul
          role="listbox"
          aria-label={t("Clientes encontrados")}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-md"
        >
          {lista.isLoading ? (
            <li className="px-3 py-2 text-xs text-text-subtle">{t("Buscando…")}</li>
          ) : contatos.length === 0 ? (
            <li className="px-3 py-2 text-xs text-text-subtle">{t("Nenhum cliente encontrado.")}</li>
          ) : (
            contatos.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  data-testid={`cliente-${c.id}`}
                  // `onMouseDown` e não `onClick`: o `blur` do campo dispara antes
                  // do clique e fecharia a lista com ele no ar.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ id: c.id, nome: rotuloDoContato(c, t), telefone: c.phone_number ?? null });
                    setBusca("");
                    setAberto(false);
                  }}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-surface-elevated",
                  )}
                >
                  <span className="truncate text-sm text-text">{rotuloDoContato(c, t)}</span>
                  {c.phone_number ? (
                    <span className="text-[11px] tabular-nums text-text-subtle">
                      {phoneForDisplay(c.phone_number)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
