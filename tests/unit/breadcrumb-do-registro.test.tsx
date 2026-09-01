/**
 * O "onde estou" do cabeçalho — derivado do REGISTRO, nunca de uma lista própria.
 *
 * POR QUE ESTE ARQUIVO EXISTE: a forma óbvia de escrever um breadcrumb é um mapa
 * de rota → título dentro do componente. Seria a QUARTA lista descrevendo o mesmo
 * conjunto de telas, e as três anteriores (menu, hub de Configurações, abas de
 * IA) divergiram até deixar sete telas alcançáveis só por dentro da própria
 * seção — a história que `lib/navigation/registry.ts` conta no cabeçalho.
 *
 * Estes casos medem TEXTO NA TELA para rotas reais. Um teste que conferisse
 * "o componente importa NAV_DESTINATIONS" seria evidência de símbolo presente,
 * não de comportamento presente: um componente que importasse o registro e
 * ignorasse o resultado passaria.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Breadcrumb } from "@/components/shell/header/Breadcrumb";

let rota = "/app/inbox";
vi.mock("next/navigation", () => ({ usePathname: () => rota }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

function em(pathname: string) {
  rota = pathname;
  return render(<Breadcrumb />);
}

afterEach(cleanup);

describe("o breadcrumb do cabeçalho", () => {
  it("mostra grupo e tela, com o nome que o menu usa", () => {
    em("/app/inbox");
    expect(screen.getByText("Atendimento")).toBeTruthy();
    expect(screen.getByText("Inbox")).toBeTruthy();
  });

  it("uma tela de detalhe herda o nome da lista de onde veio", () => {
    // /app/ai/agents/<uuid> não é destino do registro, e não pode ficar sem
    // rótulo: quem abre um agente precisa continuar sabendo onde está.
    em("/app/ai/agents/f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(screen.getByText("Inteligência Artificial")).toBeTruthy();
    expect(screen.getByText("Agentes")).toBeTruthy();
  });

  it("uma tela aninhada em /app/settings mostra o grupo em que ela MORA", () => {
    // As Etapas do funil moram em CRM, ainda que a URL passe por settings. Este
    // é o caso que o breadcrumb erraria se casasse pelo primeiro prefixo.
    em("/app/settings/tenant/pipelines");
    expect(screen.getByText("CRM")).toBeTruthy();
    expect(screen.getByText("Etapas do funil")).toBeTruthy();
  });

  it("o hub de um grupo se nomeia pelo hub, não por um destino de dentro", () => {
    em("/app/ai");
    expect(screen.getByText("Central de IA")).toBeTruthy();
  });

  it("a folha do caminho é a que carrega aria-current", () => {
    // Sem isto o leitor de tela lê duas migalhas com o mesmo peso, e a pessoa
    // não sabe qual delas é a página aberta.
    em("/app/webhooks");
    const atual = screen.getByText("Webhooks");
    expect(atual.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Canais").getAttribute("aria-current")).toBeNull();
  });

  it("numa rota que o registro não conhece, não desenha nada", () => {
    // Guarda de vacuidade dos cinco de cima: um componente que sempre desenhasse
    // alguma coisa passaria em todos eles. E é o comportamento certo — inventar
    // um rótulo aqui recriaria a lista paralela que este arquivo existe para
    // impedir.
    const { container } = em("/app/rota-que-nao-existe");
    expect(container.firstChild).toBeNull();
  });
});
