/**
 * O CABEÇALHO SOME NO INBOX — e o sino não some com ele.
 *
 * ## A falha que este arquivo existe para impedir
 *
 * A decisão é lida em DOIS lugares: a casca (`AppShell`), que não desenha o
 * cabeçalho, e o rodapé da barra lateral, que adota o que ficou órfão. Se os
 * dois divergirem, não há erro — há o sino DUAS vezes na tela, ou NENHUMA. As
 * duas falhas são mudas, e a segunda é a pior: o aviso de mensagem nova
 * desaparece justo na tela em que a pessoa passa o dia.
 *
 * ⚠️ O CONJUNTO CONDICIONAL ENCOLHEU. Eram quatro peças (sino, idioma, tema,
 * avatar) e hoje é uma. O idioma virou campo em Configurações › Perfil, o tema
 * deixou de existir, e a CONTA passou a morar no rodapé em toda rota — ela é o
 * único caminho de saída da conta do produto, e condicioná-la a uma rota era
 * apostar que a condição nunca erra. O caso "a conta está no rodapé em TODA
 * rota", no fim do arquivo, é a rede dessa mudança.
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
 * `HeaderActions` (hoje: o sino) de mentira, e o `data-testid` é o que importa.
 *
 * O de verdade arrasta o react-query do contador de avisos, que não tem nada a
 * ver com ONDE ele aparece. O que este arquivo mede é o lugar, e o lugar é
 * observável pelo marcador.
 *
 * ⚠️ `ContaNaBarra` NÃO é mockado de propósito: a pergunta "a saída da conta
 * existe?" só vale se o componente de verdade estiver na árvore.
 */
vi.mock("@/components/shell/header/HeaderActions", () => ({
  HeaderActions: () => <div data-testid="acoes-de-conta" />,
}));
/* ⚠️ O SINO É MOCKADO DIRETO, e não mais pelo `HeaderActions` que o embrulhava.
   O rodapé passou a importar `AlertsBell` para desenhá-lo como LINHA de largura
   cheia (`variante="linha"`), e o mock do wrapper deixou de interceptar: o sino
   real subiu na árvore e pediu um `QueryClientProvider` que nenhum destes
   testes monta. O sintoma foi "No QueryClient set" em 16 casos que não têm nada
   a ver com aviso. */
vi.mock("@/components/shell/AlertsBell", () => ({
  AlertsBell: () => <div data-testid="acoes-de-conta" />,
}));

function montar(pathname: string) {
  rota = pathname;
  return render(
    <AppShell sidebarCollapsed={false} gruposAbertosSalvos={null}>
      <p>conteúdo</p>
    </AppShell>,
  );
}

/**
 * ⚠️ ERA `queryByRole("navigation", { name: "Você está em" })` — o BREADCRUMB,
 * que saiu do produto. Ele era uma sonda por acaso: media o cabeçalho pelo
 * conteúdo mais frágil dele, e sumiu junto com uma decisão de desenho.
 *
 * `banner` é o papel do próprio `<header>`, e é o que este arquivo quer
 * perguntar: a faixa está montada? Sobrevive a qualquer troca do que mora
 * dentro dela.
 */
const cabecalho = () => screen.queryByRole("banner");

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
  it("no Inbox o cabeçalho é marcado para sumir, e o rodapé adota os avisos", () => {
    montar("/app/inbox");
    expect(screen.getByTestId("cabecalho-do-app")).toHaveAttribute("data-some-em-md", "true");
    expect(screen.getByTestId("avisos-na-barra")).toBeInTheDocument();
    // E o cabeçalho segue MONTADO — é ele quem carrega o ☰ no celular.
    expect(cabecalho()).toBeInTheDocument();
  });

  it("fora do Inbox o cabeçalho fica, e o rodapé não adota os avisos", () => {
    montar("/app/kanban");
    expect(screen.getByTestId("cabecalho-do-app")).not.toHaveAttribute("data-some-em-md");
    expect(screen.queryByTestId("avisos-na-barra")).toBeNull();
    expect(cabecalho()).toBeInTheDocument();
  });

  it("as duas pontas nunca discordam — é a coerência que evita o sino em dobro", () => {
    // A asserção que sozinha justifica o arquivo. Os dois casos acima passariam
    // com as pontas divergindo: um mede o cabeçalho, o outro mede o rodapé, e
    // nenhum dos dois pergunta se as duas decisões vieram da MESMA resposta.
    //
    // As duas combinações proibidas: cabeçalho marcado para sumir sem o rodapé
    // adotar (o sino desaparece do produto) e o rodapé adotando com o cabeçalho
    // de pé (dois sinos com o mesmo contador em qualquer tela larga).
    //
    // ⚠️ ANTES ISTO MEDIA AS "AÇÕES DE CONTA", e o conjunto era outro: sino,
    // idioma, tema e avatar. Hoje o idioma e o tema não existem como peça de
    // casca e a CONTA não é mais condicional — ela mora no rodapé em toda rota
    // (o caso abaixo). O que sobrou de condicional é o aviso, e é ele que este
    // laço vigia.
    for (const rota of ["/app/inbox", "/app/inbox/abc", "/app/kanban", "/app/contacts"]) {
      cleanup();
      montar(rota);
      const some = screen.getByTestId("cabecalho-do-app").getAttribute("data-some-em-md") === "true";
      const adotou = screen.queryByTestId("avisos-na-barra") !== null;
      expect(adotou, `${rota}: rodapé e cabeçalho discordaram`).toBe(some);
    }
  });

  it("a conta está no rodapé em TODA rota — não só onde o cabeçalho some", () => {
    // ⚠️ ESTE CASO É A REDE DE SEGURANÇA DE UMA REMOÇÃO.
    //
    // O menu do usuário saiu do cabeçalho, e ele é o único caminho de saída da
    // conta no produto inteiro: `signOut()` tem um chamador só. Nenhuma spec de
    // e2e exercita logout — medido —, então um dia em que a conta deixasse de
    // ser renderizada no rodapé passaria com o CI verde e o produto sem saída.
    //
    // A contra-asserção importa tanto quanto: o rodapé NÃO pode ser o segundo
    // lugar a desenhar a conta enquanto o cabeçalho ainda a tivesse.
    for (const rota of ["/app/inbox", "/app/kanban", "/app/contacts", "/app/settings"]) {
      cleanup();
      montar(rota);
      expect(
        screen.getByTestId("acoes-de-conta-na-barra"),
        `${rota}: sem conta no rodapé, não há como sair`,
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: "Menu do usuário" }),
        `${rota}: a conta tem de existir UMA vez`,
      ).toHaveLength(1);
    }
  });
});
