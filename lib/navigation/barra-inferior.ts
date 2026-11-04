/**
 * A barra de abas do CELULAR (abaixo de `md`) — a regra pura.
 *
 * ═══ Por que existe ═══
 *
 * No telefone a navegação inteira morava num ☰ no canto superior esquerdo: o
 * ponto mais longe do polegar, e um toque a mais para tudo. No Inbox o
 * cabeçalho some para a conversa ganhar altura, e o ☰ ia junto — sobrava o
 * voltar do aparelho como única saída. Pedido do dono do produto (04/11/2026):
 * "a navegação no celular é ruim demais; quero o inbox parecido com o WhatsApp".
 *
 * ═══ O que NÃO é ═══
 *
 * Não é uma segunda lista de telas. As abas são HREFS do `NAV_DESTINATIONS`, e
 * rótulo, ícone e papel mínimo vêm de lá — uma tela nova continua tendo uma
 * porta só (o registro), e a barra não pode mostrar a quem não pode entrar.
 * O resto do produto fica a um toque, no "Mais", que abre a MESMA gaveta.
 */
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import type { Role } from "@/lib/auth/types";
import { canSee, NAV_DESTINATIONS } from "@/lib/navigation/registry";

/** As telas de uso diário de quem atende pelo telefone, na ordem do polegar. */
export const ABAS_DA_BARRA_INFERIOR = [
  "/app/inbox",
  "/app/kanban",
  "/app/contacts",
  "/app/agenda",
] as const;

/**
 * Rótulo CURTO onde o do registro não cabe numa aba de 1/5 da tela, ou não é a
 * palavra que quem atende usa. "Inbox" é o nome da tela; "Conversas" é o que se
 * procura nela — o mesmo título que a lista mostra no topo.
 */
const ROTULO_CURTO: Partial<Record<(typeof ABAS_DA_BARRA_INFERIOR)[number], string>> = {
  "/app/inbox": "Conversas",
  "/app/kanban": "Kanban",
};

export interface AbaDaBarraInferior {
  href: string;
  rotulo: string;
  icon: PhosphorIcon;
}

export function abasDaBarraInferior(
  isPlatformAdmin: boolean,
  role: Role | null,
): AbaDaBarraInferior[] {
  const abas: AbaDaBarraInferior[] = [];
  for (const href of ABAS_DA_BARRA_INFERIOR) {
    const destino = NAV_DESTINATIONS.find((d) => d.href === href);
    if (!destino || !canSee(destino, isPlatformAdmin, role)) continue;
    abas.push({ href, rotulo: ROTULO_CURTO[href] ?? destino.label, icon: destino.icon });
  }
  return abas;
}

/** A aba acesa: a própria rota ou qualquer tela dentro dela (`/app/contacts/<id>`). */
export function abaAtiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Some com uma CONVERSA ABERTA, como no WhatsApp: ali o rodapé é do campo de
 * escrever, e duas barras no pé da tela dividiriam o polegar. A conversa aberta
 * é o `?id=` do Inbox (é na URL que ela vive — ver `InboxLayout`), e
 * `/app/inbox/<id>` é o deep-link antigo, que redireciona para o mesmo lugar.
 */
export function barraInferiorVisivel(pathname: string, idDaConversa: string | null): boolean {
  if (pathname.startsWith("/app/inbox/")) return false;
  if (pathname === "/app/inbox" && idDaConversa) return false;
  return true;
}

/**
 * As classes de uma aba. Moram aqui, e não no componente, porque o "Mais" é
 * desenhado por OUTRO componente (`MobileSidebar`, que é dono da gaveta) e as
 * cinco abas precisam ser uma fileira só, não quatro e uma parecida.
 */
export const CLASSE_ABA =
  "group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium leading-none text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[ativa=true]:text-foreground";

/** O fundo em pílula atrás do ícone da aba acesa — o sinal do WhatsApp/Material. */
export const CLASSE_ICONE_DA_ABA =
  "flex h-7 w-14 items-center justify-center rounded-full transition-colors group-data-[ativa=true]:bg-accent-soft group-data-[ativa=true]:text-accent";

export const CLASSE_ROTULO_DA_ABA = "max-w-full truncate px-1";
