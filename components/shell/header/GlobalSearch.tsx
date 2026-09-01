"use client";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { CommandPalette } from "@/components/shell/CommandPalette";
import { useT } from "@/hooks/i18n/useT";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";

/**
 * A busca do cabeçalho, no formato do Spotlight.
 *
 * ⚠️ É UM BOTÃO QUE PARECE UM CAMPO, e isso é deliberado. Um `<input>` de
 * verdade aqui teria de abrir o `CommandPalette` no primeiro caractere e depois
 * transferir foco e valor para o campo de dentro do diálogo — dois campos
 * disputando o mesmo texto, e o segundo perdendo o que foi digitado no primeiro
 * em toda máquina lenta. O botão abre o diálogo, e quem digita já digita no
 * campo que vale.
 *
 * O atalho e o diálogo são os mesmos de antes; o que mudou é a forma do gatilho.
 *
 * O nome do produto entra no placeholder pela marca resolvida — "Buscar no
 * Lidia..." numa instalação, "Buscar no <revendedor>..." na outra. Escrever o
 * nome à mão aqui seria vazamento de marca, que `tests/unit/branding.test.ts`
 * varre em `app|components|lib|workers|hooks`.
 */
export function GlobalSearch() {
  const t = useT();
  const marca = useMarcaDaInstalacao();
  const [open, setOpen] = useState(false);

  // `enableOnFormTags`: o atalho precisa funcionar com o cursor dentro do
  // composer do inbox, que é onde o operador passa o dia.
  useHotkeys("mod+k", () => setOpen(true), { preventDefault: true, enableOnFormTags: true });

  return (
    <>
      {/* No celular a busca é a LUPA, e o campo inteiro não existe: 38px de
          altura por 200 de largura tomariam a faixa em que moram o menu e a
          marca. Dois gatilhos, um diálogo só — montar dois `CommandPalette`
          registraria o atalho ⌘K duas vezes. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Buscar")}
        className="busca-global flex w-[38px] items-center justify-center md:hidden"
        data-testid="busca-global-compacta"
      >
        <MagnifyingGlass size={18} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className="busca-global hidden w-full items-center gap-2 px-3 md:flex"
        data-testid="busca-global"
      >
        <MagnifyingGlass size={16} className="shrink-0" aria-hidden />
        <span className="truncate text-[13px]">
          {t("Buscar no")} {marca.name}...
        </span>
        <kbd className="ml-auto hidden shrink-0 rounded-[6px] border px-1.5 py-0.5 font-sans text-[11px] text-text-subtle sm:inline">
          ⌘K
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
