/**
 * A porta do app (`/app/**`) para o painel da PLATAFORMA (`/admin/**`).
 *
 * NÃO entra em `NAV_DESTINATIONS` (`./registry.ts`): aquele registro descreve a
 * navegação do tenant, e `canSee` devolve `true` para platform admin em TODO
 * destino — não existe `minRole` que signifique "só platform admin". Pôr o
 * painel lá o faria aparecer por papel de tenant, que é a regra errada: um
 * `admin` de organização não é administrador da instalação.
 *
 * A regra aqui é uma só, `user.is_platform_admin`, e os três lugares que
 * mostram a porta (rodapé da barra, menu da conta e ⌘K) leem ESTA constante.
 * O botão é conveniência: quem barra de verdade é `proxy.ts` (RPC
 * `fn_is_platform_admin`) e `requirePlatformAdmin()` no layout de `/admin`.
 */
import { ShieldStar } from "@/lib/ui/icons";

export const PORTA_DO_ADMIN = {
  href: "/admin/dashboard",
  label: "Admin da plataforma",
  description: "Usuários, organizações, relatórios e configuração da instalação.",
  icon: ShieldStar,
} as const;

export function mostraPortaDoAdmin(user: { is_platform_admin?: boolean | null } | null | undefined): boolean {
  return user?.is_platform_admin === true;
}
