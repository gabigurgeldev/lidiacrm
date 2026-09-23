"use client";
import Link from "next/link";

import { ArrowCircleUp } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { useSystemVersion } from "@/hooks/system/useSystemVersion";

/**
 * Versão instalada na faixa baixa da barra, ao lado do botão de recolher. Vira
 * um aviso clicável só para quem é dono do servidor E tem versão nova — quem
 * não pode atualizar não é alertado sobre algo que não pode resolver.
 *
 * ⚠️ A PROP É `compacto`, e não `collapsed`. As duas divergem entre 768 e
 * 1023px: ali a barra tem 72px por `@media`, mas o cookie continua dizendo
 * "expandida". Lendo o cookie, o número da versão era escrito dentro de uma
 * coluna de 72px, ao lado de um botão, e transbordava. `compacto` é a mesma
 * medida que o resto da barra usa para decidir o que cabe.
 *
 * ⚠️ ESTREITA, O NÚMERO SOME INTEIRO — antes ele virava "1.4", dois segmentos
 * de uma versão de três. Meia versão não serve para conferir nada e ocupava a
 * faixa que agora é só do botão. Quem precisa do número tem a tela de
 * Configurações › Atualização, e o aviso de versão nova continua aparecendo,
 * porque esse é acionável.
 */
export function VersionFooter({
  compacto,
  onNavigate,
}: {
  compacto: boolean;
  /** Fecha a gaveta do mobile — é o único Link do drawer que não a recebia. */
  onNavigate?: () => void;
}) {
  const t = useT();
  const { data } = useSystemVersion();
  if (!data?.current_version) return null;

  const label = data.current_version.replace(/^v/i, "");
  // Só acende quando existe versão nova de verdade. `off_release` sozinho não
  // conta: uma instalação de desenvolvimento sem versão publicada mais nova
  // ficava com o ponto pulsando pra sempre, e o texto "Nova versão · " com o
  // número vazio, apontando para uma tela que não tem o que oferecer.
  const alerta = data.is_owner && data.update_available;

  if (!alerta) {
    if (compacto) return null;
    return (
      <p className="truncate px-1 text-[11px] text-text-subtle" title={`${t("Versão")} ${label}`}>
        {t("versão")} {label}
      </p>
    );
  }

  const novo = data.latest_version?.replace(/^v/i, "") ?? "";
  return (
    <Link
      href="/app/settings/atualizacao"
      onClick={onNavigate}
      title={`${t("Nova versão")} ${novo} ${t("disponível")}`}
      className="nav-versao-aviso"
    >
      {/* Tokens do produto, não aliases do shadcn: `bg-primary` era o alias, e
          dentro de `.casca-escura` a casca inteira fala um vocabulário só — ver
          o cabeçalho de `AlertsBell`. O ponto e o pulso vivem em
          `.nav-versao-pulso` no globals.css. */}
      <span className="nav-versao-pulso" aria-hidden />
      {compacto ? (
        <ArrowCircleUp size={16} weight="duotone" aria-hidden />
      ) : (
        <span className="truncate">
          {t("Nova versão")}
          {novo ? ` · ${novo}` : ""}
        </span>
      )}
    </Link>
  );
}
