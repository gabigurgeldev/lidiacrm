/**
 * ⌘K. Até aqui a barra "Buscar…" do topo era um `console.info` com o comentário
 * "UI not yet implemented" — a única saída de emergência para quem não achava
 * uma tela era uma promessa vazia.
 *
 * ⚠️ A v1 buscava só NAVEGAÇÃO, e este cabeçalho dizia que contato, conversa e
 * lead eram "outra feature". São esta: a paleta passou a fundir os destinos do
 * registro (locais, instantâneos) com o que `GET /api/v1/search` devolve.
 *
 * Os casos de navegação abaixo continuam medindo o que mediam — eles são a
 * não-regressão da metade que não podia mudar de comportamento.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommandPalette } from "@/components/shell/CommandPalette";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import type { SearchResult } from "@/lib/schemas/search";

const push = vi.fn();
const authRef: { user: Pick<AuthUser, "is_platform_admin">; activeOrg: ActiveOrg | null } = {
  user: { is_platform_admin: false },
  activeOrg: { orgId: "org-1", name: "Org", role: "admin" },
};

vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => authRef }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/**
 * A busca remota, de mentira — e o `get` é um espião para os casos poderem
 * afirmar que ela NÃO foi chamada com uma letra só.
 *
 * O `apiClient` de verdade fala com a rede. O que estes casos medem é o que a
 * paleta FAZ com a resposta, não o transporte dela; o transporte tem o próprio
 * teste em `lib/api/client.test.ts`, e a consulta de verdade é medida contra um
 * Postgres em `tests/invariants/`.
 */
let respostaDaBusca: SearchResult[] = [];
const getDaApi = vi.fn(async () => ({ data: { results: respostaDaBusca, parciais: false } }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...a: unknown[]) => getDaApi(...(a as [])) } }));

function comoPapel(role: ActiveOrg["role"]) {
  authRef.activeOrg = { orgId: "org-1", name: "Org", role };
}

afterEach(() => {
  cleanup();
  push.mockClear();
  getDaApi.mockClear();
  respostaDaBusca = [];
  comoPapel("admin");
});

function abrir() {
  // `retry: false`: sem isto, um caso que faça a busca falhar ficaria segundos
  // tentando de novo antes de a asserção poder rodar.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommandPalette open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("CommandPalette", () => {
  it("acha uma tela que o sidebar não mostra", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "conhec");
    expect(screen.getByRole("option", { name: /Conhecimento/ })).toBeTruthy();
  });

  it("ignora acento, porque ninguém digita acento com pressa", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "orcamento");
    expect(screen.getByRole("option", { name: /Uso e orçamento/ })).toBeTruthy();
  });

  it("busca também na descrição, não só no rótulo", async () => {
    const user = userEvent.setup();
    abrir();
    // Ninguém procura "Radar" por esse nome; procura pelo problema que resolve.
    await user.type(screen.getByRole("combobox"), "esfriou");
    expect(screen.getByRole("option", { name: /Radar/ })).toBeTruthy();
  });

  it("respeita o papel", async () => {
    comoPapel("agent");
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "audit");
    expect(screen.queryByRole("option", { name: /Audit Log/ })).toBeNull();
  });

  it("Enter navega para o item destacado", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "conhec");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/app/ai/knowledge/sources");
  });

  it("seta para baixo move o destaque antes do Enter", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "a");
    await user.keyboard("{ArrowDown}{Enter}");
    const segundo = screen.getAllByRole("option")[1];
    expect(segundo).toBeDefined();
    expect(push).toHaveBeenCalledWith(segundo?.getAttribute("data-href"));
  });

  it("sem texto, oferece o trabalho do dia em vez de tela vazia", () => {
    abrir();
    expect(screen.getByRole("option", { name: /Inbox/ })).toBeTruthy();
  });

  it("diz quando não achou, em vez de sumir sem explicação", async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "zzzzzz");
    await waitFor(() => expect(screen.getByText(/Nada encontrado/i)).toBeTruthy());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

/**
 * A metade NOVA: o que a paleta faz com contato, conversa e lead.
 *
 * O que estes casos NÃO provam, declarado: que a consulta ao Postgres devolva
 * as linhas certas, e que ela não atravesse organizações. Isso é
 * `tests/invariants/busca-global-nao-vaza-entre-organizacoes.test.ts`, contra
 * um banco de verdade — aqui o transporte é dublê.
 */
describe("CommandPalette · registros do CRM", () => {
  const CONTATO: SearchResult = {
    kind: "contact",
    id: "c1",
    title: "Joana Ribeiro",
    subtitle: "+5511999990000",
    href: "/app/contacts/c1",
  };
  const CONVERSA: SearchResult = {
    kind: "conversation",
    id: "k1",
    title: "Joana Ribeiro",
    subtitle: "Bom dia, consegue me atender?",
    href: "/app/inbox/k1",
  };
  const LEAD: SearchResult = {
    kind: "lead",
    id: "l1",
    title: "Joana — plano anual",
    subtitle: "Proposta enviada",
    href: "/app/pipelines/p1?lead=l1",
  };

  it("mostra contato, conversa e lead em seções nomeadas", async () => {
    respostaDaBusca = [CONTATO, CONVERSA, LEAD];
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "joana");

    await waitFor(() => expect(screen.getByText("Contatos")).toBeTruthy());
    expect(screen.getByText("Conversas")).toBeTruthy();
    expect(screen.getByText("Leads")).toBeTruthy();
    // O subtítulo é o que diferencia duas linhas com o MESMO título — contato e
    // conversa da mesma pessoa. Sem ele a lista mostraria "Joana Ribeiro" duas
    // vezes, sem dizer qual leva a quê.
    expect(screen.getByText("+5511999990000")).toBeTruthy();
    expect(screen.getByText("Bom dia, consegue me atender?")).toBeTruthy();
  });

  it("o Enter abre o registro destacado, e não só página", async () => {
    // A prova de que as setas percorrem a lista FUNDIDA: o alvo está depois das
    // páginas, e só se chega nele contando por cima delas.
    respostaDaBusca = [CONTATO];
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "joana");

    await waitFor(() => expect(screen.getByText("Contatos")).toBeTruthy());
    const opcoes = screen.getAllByRole("option");
    const indiceDoContato = opcoes.findIndex(
      (o) => o.getAttribute("data-href") === "/app/contacts/c1",
    );
    expect(indiceDoContato, "o contato tem de estar na lista").toBeGreaterThanOrEqual(0);

    for (let i = 0; i < indiceDoContato; i++) await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/app/contacts/c1");
  });

  it("NÃO pergunta ao servidor com uma letra só", async () => {
    // O piso de dois caracteres é o que impede um `ilike '%a%'` por tabela a
    // cada tecla. Ele vive no schema (o servidor recusaria com 422), e este caso
    // prova que o cliente não chega a gastar a viagem.
    //
    // ⚠️ A espera de 400ms é contra o DEBOUNCE (250ms), não contra a rede: sem
    // ela o caso passaria porque a pergunta ainda não teria saído, e não porque
    // ela nunca sai — um verde por impaciência.
    respostaDaBusca = [CONTATO];
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "a");
    await new Promise((r) => setTimeout(r, 400));

    expect(getDaApi).not.toHaveBeenCalled();
    // A contraprova de que a asserção acima não é vácuo: com a resposta armada,
    // se a chamada tivesse saído, o telefone estaria na tela.
    //
    // ⚠️ E a sonda é o TELEFONE, não a palavra "Contatos": esta também é o
    // rótulo de uma PÁGINA do menu (`/app/contacts`), que a letra "a" casa.
    // Medido — a primeira versão deste caso reprovou por isso, achando o item
    // de navegação e concluindo que a busca remota tinha rodado.
    expect(screen.queryByText("+5511999990000")).toBeNull();
  });

  it("com duas letras, aí sim pergunta — a guarda de vacuidade do caso acima", async () => {
    respostaDaBusca = [CONTATO];
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "jo");

    await waitFor(() => expect(getDaApi).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Contatos")).toBeTruthy());
  });

  it("uma busca que falha não apaga as páginas que já estavam na tela", async () => {
    // Degradar é melhor que mentir: se o banco recusar, quem digitou continua
    // com a navegação — que é o que a paleta sempre soube fazer sem rede.
    getDaApi.mockRejectedValueOnce(new Error("banco fora do ar"));
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByRole("combobox"), "inbox");
    await waitFor(() => expect(screen.getByRole("option", { name: /Inbox/ })).toBeTruthy());
  });
});
