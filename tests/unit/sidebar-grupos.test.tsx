/**
 * Sidebar agrupado por objetivo, com os grupos recolhíveis. O que estes testes
 * protegem:
 *
 *  - a hierarquia existe (o usuário reclamou de 17 itens no mesmo peso visual);
 *  - Funis é alcançável sem passar por Configurações — o achado que originou tudo;
 *  - agrupar não criou cabeçalho órfão (grupo cujos filhos a permissão filtrou);
 *  - o grupo da rota atual nasce aberto, e os outros nascem como o cookie disser;
 *  - recolher um grupo grava a escolha.
 *
 * A regra de quem-vê-o-quê é do registro e está coberta em
 * `navegacao-registry.test.ts`; aqui é a superfície.
 *
 * ⚠️ O QUE ESTE ARQUIVO NÃO PODE PROVAR, declarado: que um grupo fechado ESCONDE
 * os itens. O esconder é `visibility: hidden` numa folha de estilo, e o jsdom não
 * aplica folha de estilo nenhuma — os links continuam no DOM e continuam sendo
 * achados por `getByRole` aqui. Quem prova isso é `tests/e2e/navegacao.spec.ts`,
 * medindo `getComputedStyle` no navegador de verdade. Um teste daqui afirmando
 * "sumiu" seria falha-em-verde.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/shell/Sidebar";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { COOKIE_GRUPOS } from "@/lib/navigation/grupos-abertos";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

const authRef: { user: Pick<AuthUser, "is_platform_admin">; activeOrg: ActiveOrg | null } = {
  user: { is_platform_admin: false },
  activeOrg: null,
};

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => authRef,
  usePermission: () => false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/inbox",
}));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({
  toggleSidebar: vi.fn(),
}));
// Busca a versão via react-query; sem QueryClientProvider ele lança, e o
// rodapé de versão não é o que estes testes examinam.
vi.mock("@/components/shell/VersionFooter", () => ({
  VersionFooter: () => null,
}));
/**
 * ⚠️ MOCK NOVO, e ele registra um ACOPLAMENTO que a barra não tinha.
 *
 * O rodapé passou a adotar as ações de conta (sino, idioma, tema, avatar)
 * quando o cabeçalho do app não é desenhado — e a rota mockada aqui é
 * `/app/inbox`, que é exatamente o caso. `HeaderActions` arrasta `ThemeProvider`
 * (lança sem ele), `AuthProvider` e o react-query do sino: sem este mock, os 16
 * casos deste arquivo morrem em "useTheme must be used within <ThemeProvider>",
 * medindo a montagem do cabeçalho em vez da navegação.
 *
 * Que o rodapé REALMENTE adota as ações é provado onde essa é a pergunta:
 * `tests/unit/casca-esconde-o-cabecalho.test.tsx`.
 */
vi.mock("@/components/shell/header/HeaderActions", () => ({
  HeaderActions: () => null,
}));

function comoPapel(role: ActiveOrg["role"]) {
  authRef.user = { is_platform_admin: false };
  authRef.activeOrg = { orgId: "org-1", name: "Org", role };
}

const grupo = (nome: string) => screen.getByRole("button", { name: nome });

beforeEach(() => {
  document.cookie = `${COOKIE_GRUPOS}=; path=/; max-age=0`;
});
afterEach(cleanup);

describe("Sidebar agrupado", () => {
  it("renderiza os títulos de grupo na ordem de uso", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    const titulos = screen
      .getAllByRole("heading")
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    // Organização não tem título aqui: seu hub (Configurações) vive no rodapé
    // fixo, fora da área que rola — medido, ele caía fora da dobra até em 1080px.
    //
    // ⚠️ "Agente de IA" virou "Inteligência Artificial": o grupo deixou de conter
    // só o agente (Provedores, Uso e orçamento e Execuções são do sistema).
    expect(titulos).toEqual([
      "Atendimento",
      "CRM",
      "Inteligência Artificial",
      "Canais",
      "Análise",
    ]);
  });

  it("o título é um botão DENTRO de um heading, e não um dos dois", () => {
    // As duas coisas de uma vez, e o teste existe porque é tentador escolher uma:
    // o `<button>` é o controle que recolhe (`aria-expanded`, área inteira
    // clicável); o `<h2>` por fora é o que mantém a barra navegável por cabeçalho
    // no leitor de tela, que é como se pula de seção sem ouvir os vinte links.
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    const botao = grupo("CRM");
    expect(botao.closest("h2")).not.toBeNull();
    expect(botao.getAttribute("aria-expanded")).toBe("false");
  });

  it("leva às Etapas do funil sem passar por Configurações", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    // O rótulo mudou: "Funis" passou a ser a LISTA (/app/kanban) e esta tela,
    // que configura as colunas, virou "Etapas do funil". Antes as duas
    // disputavam o mesmo nome no mesmo grupo do menu.
    const etapas = screen.getByRole("link", { name: "Etapas do funil" });
    expect(etapas).toHaveAttribute("href", "/app/settings/tenant/pipelines");
  });

  it("e os dois itens de funil não disputam o mesmo nome", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("link", { name: "Funis" })).toHaveAttribute("href", "/app/kanban");
  });

  it("desenterra Nuvemshop e Audit Log", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    // Nuvemshop não tinha link nenhum no app; Audit Log só existia via card em
    // Configurações. Canal oficial não está aqui de propósito: virou aba de
    // Conexões no PR #105, e Conexões é a porta.
    expect(screen.getByRole("link", { name: /Nuvemshop/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Audit Log/ })).toBeTruthy();
  });

  it("Configurações fica no rodapé, nunca dependendo de scroll", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    const config = screen.getByRole("link", { name: /Configurações/ });
    expect(config).toHaveAttribute("href", "/app/settings");
    // Fora da <nav> que rola.
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    expect(nav.contains(config)).toBe(false);
  });

  it("não deixa cabeçalho órfão quando a permissão esvazia o grupo", () => {
    // CANAIS é todo manager+/admin. Um agent não pode ver o título sozinho.
    comoPapel("agent");
    render(<Sidebar collapsed={false} />);
    const titulos = screen.getAllByRole("heading").map((el) => el.textContent?.trim());
    expect(titulos).not.toContain("Canais");
    expect(titulos).toContain("Atendimento");
  });

  it("oferece o hub dos grupos que têm um", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    // ⚠️ ERA "Ver tudo em IA". Com o cabeçalho do grupo agora clicável, "Ver tudo
    // em X" descrevia o gesto que o próprio cabeçalho passou a fazer — dois
    // controles vizinhos prometendo a mesma coisa.
    expect(screen.getByRole("link", { name: /Central de IA/ })).toHaveAttribute(
      "href",
      "/app/ai",
    );
  });

  it("recolhida, a barra se anuncia estreita e mantém os links", () => {
    comoPapel("admin");
    const { container } = render(<Sidebar collapsed />);
    // O esconder do rótulo é CSS (`.app-sidebar[data-collapsed="true"]
    // .nav-rotulo`), e o jsdom não tem CSS: o que dá para provar aqui é que o
    // sinal de que a folha depende está no DOM. O efeito visual é medido por
    // `getComputedStyle` em `tests/e2e/navegacao.spec.ts`.
    expect(container.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByRole("link", { name: /Inbox/ })).toBeTruthy();
  });

  it("em espanhol, a barra aparece em espanhol", () => {
    // O COMPORTAMENTO por trás do seletor de idioma, que antes só era conferido
    // por varredura de fonte (`idioma-da-interface.test.ts` procurava `t(` no
    // arquivo). Varredura de fonte prova que o símbolo está lá; um `t()` que
    // recebesse a chave errada passaria nela e mostraria português.
    comoPapel("admin");
    render(
      <IdiomaProvider locale="es">
        <Sidebar collapsed={false} />
      </IdiomaProvider>,
    );
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inteligencia Artificial" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contactos" })).toBeTruthy();
  });

  it("marca a rota atual com aria-current", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
    // "Kanban" saiu da interface; o item da mesma URL agora se chama "Funis".
    expect(screen.getByRole("link", { name: "Funis" })).not.toHaveAttribute("aria-current");
  });
});

describe("os grupos recolhem, e a escolha sobrevive", () => {
  it("o grupo da rota atual nasce aberto e os outros nascem fechados", () => {
    // A rota mockada é /app/inbox, que mora em Atendimento. Sem esta regra, quem
    // chega por um link direto veria uma barra sem nenhuma marca de onde está.
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    expect(grupo("Atendimento").getAttribute("aria-expanded")).toBe("true");
    expect(grupo("Canais").getAttribute("aria-expanded")).toBe("false");
  });

  it("clicar no cabeçalho alterna, e o corpo acompanha", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    const botao = grupo("Canais");
    const corpo = document.getElementById(botao.getAttribute("aria-controls")!);

    expect(corpo?.getAttribute("data-aberto")).toBe("false");
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(corpo?.getAttribute("data-aberto")).toBe("true");
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(corpo?.getAttribute("data-aberto")).toBe("false");
  });

  it("abrir um grupo GRAVA a escolha no cookie", () => {
    // O laço inteiro da persistência: sem esta gravação o F5 devolveria a barra
    // ao arranjo de fábrica, que é a queixa que o recolhimento veio resolver.
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    fireEvent.click(grupo("Canais"));
    expect(document.cookie).toContain(`${COOKIE_GRUPOS}=`);
    expect(decodeURIComponent(document.cookie)).toContain("canais");
  });

  it("respeita o que veio do servidor, sem esquecer o grupo da rota", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} gruposAbertosSalvos={["canais"]} />);
    expect(grupo("Canais").getAttribute("aria-expanded")).toBe("true");
    expect(grupo("CRM").getAttribute("aria-expanded")).toBe("false");
    // Atendimento não está no cookie e mesmo assim abre: é onde a pessoa está.
    expect(grupo("Atendimento").getAttribute("aria-expanded")).toBe("true");
  });

  it("a seta para a direita abre o grupo, e a da esquerda fecha", () => {
    // WCAG 2.1.1: a barra é a única porta para vinte telas. Sem teclado, quem não
    // usa mouse depende de Tab passar por cada link até chegar no grupo certo.
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    const botao = grupo("Análise");

    fireEvent.keyDown(botao, { key: "ArrowRight" });
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(botao, { key: "ArrowLeft" });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    // Idempotente: a seta que já apontava para o estado atual não alterna.
    fireEvent.keyDown(botao, { key: "ArrowLeft" });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
  });
});
