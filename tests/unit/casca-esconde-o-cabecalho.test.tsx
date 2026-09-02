/**
 * O CABEÇALHO SOME NO INBOX — e as ações de conta não somem com ele.
 *
 * ## A falha que este arquivo existe para impedir
 *
 * A decisão é lida em DOIS lugares: a casca (`AppShell`), que não desenha o
 * cabeçalho, e o rodapé da barra lateral, que adota o que ficou órfão. Se os
 * dois divergirem, não há erro — há o sino e o avatar DUAS vezes na tela, ou
 * NENHUMA. As duas falhas são mudas, e a segunda é a pior: o aviso de mensagem
 * nova desaparece justo na tela em que a pessoa passa o dia.
 *
 * Por isso a regra é uma função só (`lib/navigation/casca.ts`) e por isso o
 * caso decisivo abaixo mede as duas pontas na MESMA árvore.
 *
 * ## O que este arquivo NÃO prova, e a descoberta que obrigou a escrever isto
 *
 * Que no Inbox o cabeçalho SUMA DA TELA. Ele continua no DOM: quem o esconde é
 * `md:hidden`, e o jsdom não aplica folha de estilo nenhuma. Descobri medindo —
 * a primeira versão deste arquivo afirmava "nunca nos dois lugares" e reprovou
 * com dois `HeaderActions` na árvore, um no cabeçalho e outro no rodapé.
 *
 * A afirmação estava errada, não o código: no celular os dois EXISTEM mesmo, e
 * é o certo. Ali o cabeçalho é a única porta para a navegação (é onde mora o ☰),
 * e a barra lateral inteira está sob `hidden md:block` — `display: none`, fora
 * da árvore de acessibilidade. O que não pode acontecer é os dois ficarem
 * VISÍVEIS ao mesmo tempo, e isso é uma pergunta de pixel.
 *
 * Então aqui se prova a COERÊNCIA entre as duas pontas, que é o que causa o
 * defeito: o rodapé adota as ações exatamente quando o cabeçalho está marcado
 * para sumir, nunca em outra combinação. A prova visual — o cabeçalho ausente em
 * 1440px e presente em 390px — é do e2e, com `getComputedStyle`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { cabecalhoEscondidoEm } from "@/lib/navigation/casca";
import { AppShell } from "@/app/app/_components/AppShell";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

let rota = "/app/inbox";
vi.mock("next/navigation", () => ({ usePathname: () => rota }));

const authRef: { user: Pick<AuthUser, "is_platform_admin">; activeOrg: ActiveOrg | null } = {
  user: { is_platform_admin: false },
  activeOrg: { orgId: "org-1", name: "Org", role: "admin" },
};
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => authRef,
  useUser: () => ({ id: "u1", email: "a@b.test", full_name: "A", organizations: [] }),
  useActiveOrg: () => authRef.activeOrg,
  usePermission: () => false,
}));

// Os alertas e o service worker falam com o servidor e com o navegador; nenhum
// deles é a pergunta aqui.
vi.mock("@/hooks/notifications/useInboundMessageAlerts", () => ({
  useInboundMessageAlerts: () => {},
}));
vi.mock("@/hooks/notifications/useCrmAlerts", () => ({ useCrmAlerts: () => {} }));
vi.mock("@/lib/notifications/notify_open", () => ({
  useNotifyOpenFromServiceWorker: () => {},
}));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => null }));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));

/**
 * `HeaderActions` de mentira, e o `data-testid` é o que importa.
 *
 * O de verdade arrasta `ThemeProvider`, o react-query do sino e o menu de
 * perfil — três montagens que não têm nada a ver com ONDE ele aparece. O que
 * este arquivo mede é o lugar, e o lugar é observável pelo marcador.
 */
vi.mock("@/components/shell/header/HeaderActions", () => ({
  HeaderActions: () => <div data-testid="acoes-de-conta" />,
}));

function montar(pathname: string) {
  rota = pathname;
  return render(
    <AppShell sidebarCollapsed={false} gruposAbertosSalvos={null}>
      <p>conteúdo</p>
    </AppShell>,
  );
}

const cabecalho = () => screen.queryByRole("navigation", { name: "Você está em" });

afterEach(cleanup);

describe("a regra pura", () => {
  it("vale para o Inbox e para a conversa aberta dentro dele", () => {
    expect(cabecalhoEscondidoEm("/app/inbox")).toBe(true);
    expect(cabecalhoEscondidoEm("/app/inbox/f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("não vale para o resto do produto", () => {
    for (const rota of ["/app/kanban", "/app/contacts", "/app/settings", "/app/ai/agents"]) {
      expect(cabecalhoEscondidoEm(rota), rota).toBe(false);
    }
  });

  it("não casa por prefixo de TEXTO", () => {
    // Sem a barra no `startsWith`, uma rota futura chamada `/app/inboxes`
    // herdaria o comportamento do Inbox sem ninguém pedir.
    expect(cabecalhoEscondidoEm("/app/inboxes")).toBe(false);
  });
});

describe("a casca", () => {
  it("no Inbox o cabeçalho é marcado para sumir, e o rodapé adota as ações", () => {
    montar("/app/inbox");
    expect(screen.getByTestId("cabecalho-do-app")).toHaveAttribute("data-some-em-md", "true");
    expect(screen.getByTestId("acoes-de-conta-na-barra")).toBeInTheDocument();
    // E o cabeçalho segue MONTADO — é ele quem carrega o ☰ no celular.
    expect(cabecalho()).toBeInTheDocument();
  });

  it("fora do Inbox o cabeçalho fica, e o rodapé não adota nada", () => {
    montar("/app/kanban");
    expect(screen.getByTestId("cabecalho-do-app")).not.toHaveAttribute("data-some-em-md");
    expect(screen.queryByTestId("acoes-de-conta-na-barra")).toBeNull();
    expect(cabecalho()).toBeInTheDocument();
  });

  it("as duas pontas nunca discordam — é a coerência que evita o avatar em dobro", () => {
    // A asserção que sozinha justifica o arquivo. Os dois casos acima passariam
    // com as pontas divergindo: um mede o cabeçalho, o outro mede o rodapé, e
    // nenhum dos dois pergunta se as duas decisões vieram da MESMA resposta.
    //
    // As duas combinações proibidas: cabeçalho marcado para sumir sem o rodapé
    // adotar (o sino desaparece do produto) e o rodapé adotando com o cabeçalho
    // de pé (avatar duas vezes em qualquer tela larga).
    for (const rota of ["/app/inbox", "/app/inbox/abc", "/app/kanban", "/app/contacts"]) {
      cleanup();
      montar(rota);
      const some = screen.getByTestId("cabecalho-do-app").getAttribute("data-some-em-md") === "true";
      const adotou = screen.queryByTestId("acoes-de-conta-na-barra") !== null;
      expect(adotou, `${rota}: rodapé e cabeçalho discordaram`).toBe(some);
    }
  });
});
