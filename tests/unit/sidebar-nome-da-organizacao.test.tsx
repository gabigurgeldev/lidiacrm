import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/shell/Sidebar";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { DEFAULT_APP_NAME, type Branding } from "@/lib/branding";
import { MarcaDaInstalacaoProvider } from "@/lib/branding/contexto";
import {
  LOGO_PADRAO_DO_PRODUTO,
  SIMBOLO_PADRAO_DO_PRODUTO,
} from "@/lib/branding/resolve";

/**
 * O CONSUMIDOR do nome por organização — provado por comportamento, não por
 * símbolo.
 *
 * POR QUE ESTE ARQUIVO EXISTE: medido antes de escrever a feature, o nome da
 * organização não aparecia em lugar nenhum da casca para o cliente típico de um
 * revendedor — o único leitor era o `TenantSwitcher`, que devolve `null` com uma
 * organização só. Gravar `settings.branding.app_name` sem um leitor real teria
 * criado o campo decorativo clássico: a tela oferece, o código ignora, e o
 * cliente conclui que o produto está quebrado.
 *
 * Conferir que a Sidebar MENCIONA `activeOrg.marca` não bastaria — é evidência
 * de símbolo presente, não de comportamento presente. Os dois casos abaixo
 * medem o texto que a barra renderiza, com e sem a marca, e o segundo afirma
 * também a AUSÊNCIA do nome da instalação: sem isso, um componente que
 * mostrasse os dois passaria.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/app/inbox" }));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
// Os dois buscam estado do servidor e não têm nada a ver com o nome da marca.
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => null }));
/**
 * MOCK NOVO, e ele registra um ACOPLAMENTO que a barra não tinha.
 *
 * O rodapé passou a adotar as ações de conta (sino, idioma, tema, avatar)
 * quando o cabeçalho do app não é desenhado — e a rota mockada acima é
 * `/app/inbox`, que é exatamente esse caso. `HeaderActions` arrasta
 * `ThemeProvider` (lança sem ele), `AuthProvider` e o react-query do sino: sem
 * este mock os sete casos daqui morrem em
 * "useTheme must be used within <ThemeProvider>", medindo a montagem do
 * cabeçalho em vez do nome da marca, que é a única pergunta deste arquivo.
 *
 * Que o rodapé REALMENTE adota as ações é provado onde essa é a pergunta:
 * `tests/unit/casca-esconde-o-cabecalho.test.tsx`.
 */
vi.mock("@/components/shell/header/HeaderActions", () => ({
  HeaderActions: () => null,
}));
/* ⚠️ O SINO É MOCKADO DIRETO, e não mais pelo `HeaderActions` que o embrulhava.
   O rodapé passou a importar `AlertsBell` para desenhá-lo como LINHA de largura
   cheia (`variante="linha"`), e o mock do wrapper deixou de interceptar: o sino
   real subiu na árvore e pediu um `QueryClientProvider` que nenhum destes
   testes monta. O sintoma foi "No QueryClient set" em 16 casos que não têm nada
   a ver com aviso. */
vi.mock("@/components/shell/AlertsBell", () => ({
  AlertsBell: () => null,
}));

/**
 * A marca da INSTALAÇÃO, como o SERVIDOR a entrega.
 *
 * ⚠️ Isto era um `vi.mock("@/lib/branding")` até a correção do hydration
 * mismatch. Não é mais: a barra deixou de chamar `branding()` — que lia
 * `window.__PUBLIC_ENV__` no navegador e `process.env` no SSR, fontes que
 * divergiram quando o layout raiz passou a injetar a marca do BANCO — e passou a
 * receber a marca por PROP, via `MarcaDaInstalacaoProvider`. Montar o provedor
 * aqui é o jeito honesto de simular "o operador gravou um logo na tela de
 * marca": deste lado da fronteira é exatamente o que o layout raiz faz.
 *
 * `logoUrl: null` no padrão porque com logo a barra mostra a imagem NO LUGAR do
 * texto — os três primeiros casos, que medem nome, não mediriam nada.
 */
let marcaDaInstalacao: Branding = {
  name: "Sistema do Revendedor",
  logoUrl: null,
  initial: "S",
};

/** A barra como o layout raiz a monta: dentro do provedor da marca. */
function renderSidebar(props: { collapsed: boolean }) {
  return render(
    <MarcaDaInstalacaoProvider marca={marcaDaInstalacao}>
      <Sidebar collapsed={props.collapsed} />
    </MarcaDaInstalacaoProvider>,
  );
}

const usuario = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@exemplo.test",
  is_platform_admin: false,
  organizations: [],
} as unknown as AuthUser;

const org = {
  orgId: "00000000-0000-4000-8000-0000000000aa",
  name: "Loja da Ana",
  role: "admin",
} as ActiveOrg;

let contexto: { user: AuthUser; activeOrg: ActiveOrg | null } = { user: usuario, activeOrg: org };
// `useUser` entrou porque a CONTA passou a morar no rodapé da barra em toda
// rota (`components/shell/sidebar/ContaNaBarra.tsx`) — antes ela vivia no
// cabeçalho, fora desta árvore.
//
// ⚠️ O e-mail do usuário de teste NÃO pode conter nem "Sistema do Revendedor"
// nem "Loja da Ana": o rodapé escreve nome e e-mail na tela, e os casos abaixo
// medem a AUSÊNCIA desses textos. Um e-mail descuidado passaria a ser um
// segundo nó com o mesmo texto e o teste reprovaria por um motivo falso.
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ ...contexto, signOut: vi.fn() }),
  useUser: () => ({ ...usuario, full_name: "Pessoa de Teste" }),
}));

describe("o nome da marca na barra lateral", () => {
  it("sem marca da organização, mostra o nome da instalação", () => {
    // Não-regressão: a organização que nunca abriu a tela de marca precisa ver
    // exatamente o que via antes. É também a guarda de vacuidade do caso
    // seguinte — se a barra nunca mostrasse nome nenhum, os dois passariam.
    contexto = { user: usuario, activeOrg: org };
    renderSidebar({ collapsed: false });
    expect(screen.getByText("Sistema do Revendedor")).toBeTruthy();
  });

  it("com marca da organização, o nome dela SUBSTITUI o da instalação", () => {
    contexto = { user: usuario, activeOrg: { ...org, marca: { nome: "Loja da Ana" } } };
    renderSidebar({ collapsed: false });
    expect(screen.getByText("Loja da Ana")).toBeTruthy();
    // A ausência importa tanto quanto a presença: uma barra que mostrasse os
    // dois nomes passaria na asserção de cima e estaria errada.
    expect(screen.queryByText("Sistema do Revendedor")).toBeNull();
  });

  it("recolhida, a inicial acompanha o nome que a barra mostra", () => {
    // Sem isto, recolher o menu trocaria a marca: o nome viria da organização e
    // a inicial continuaria vindo da INSTALAÇÃO — "L" expandido, "S" recolhido.
    contexto = { user: usuario, activeOrg: { ...org, marca: { nome: "Loja da Ana" } } };
    renderSidebar({ collapsed: true });
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.queryByText("S")).toBeNull();
  });
});

/**
 * O CONSUMIDOR do logo — a outra metade, e a que estava faltando.
 *
 * POR QUE ESTE BLOCO EXISTE: medido antes desta onda, `platform_branding.logo_url`
 * era gravável e ilegível. O único render de logo do produto é esta barra, e ela
 * lia `window.__PUBLIC_ENV__.APP_LOGO_URL`, que vinha do `.env` cru — o operador
 * salvava e nada mudava. Estes casos medem a barra DESENHANDO a imagem, não a
 * presença do símbolo `logoUrl` no arquivo.
 *
 * O que eles NÃO provam, declarado: que a marca entregue ao provedor venha mesmo
 * do banco. Aquilo é a costura do layout raiz (`marcaResolvida()` alimentando o
 * `<MarcaDaInstalacaoProvider/>`), guardada em `tests/unit/branding.test.ts`, e a
 * prova de ponta a ponta é pela tela. Nem provam que os dois lados da fronteira
 * concordam — isso é `tests/unit/marca-sem-divergencia-de-hidratacao.test.tsx`.
 */
describe("o logo na barra lateral", () => {
  const LOGO_DA_INSTALACAO = "https://cdn.exemplo.test/revendedor.png";
  const LOGO_DA_ORG = "https://cdn.exemplo.test/loja-da-ana.png";

  afterEach(() => {
    marcaDaInstalacao = { name: "Sistema do Revendedor", logoUrl: null, initial: "S" };
  });

  const imagem = () => screen.getByRole("img");

  it("com logo da instalação, a barra desenha a imagem no lugar do nome", () => {
    marcaDaInstalacao = { ...marcaDaInstalacao, logoUrl: LOGO_DA_INSTALACAO };
    contexto = { user: usuario, activeOrg: org };
    renderSidebar({ collapsed: false });

    expect(imagem().getAttribute("src")).toBe(LOGO_DA_INSTALACAO);
    // A ausência importa: uma barra que mostrasse imagem E nome passaria só na
    // asserção de cima, e o cabeçalho tem 56px de altura para um dos dois.
    expect(screen.queryByText("Sistema do Revendedor")).toBeNull();
  });

  it("o logo da organização SUBSTITUI o da instalação", () => {
    marcaDaInstalacao = { ...marcaDaInstalacao, logoUrl: LOGO_DA_INSTALACAO };
    contexto = {
      user: usuario,
      activeOrg: { ...org, marca: { nome: "Loja da Ana", logoUrl: LOGO_DA_ORG } },
    };
    renderSidebar({ collapsed: false });

    expect(imagem().getAttribute("src")).toBe(LOGO_DA_ORG);
    // O `alt` acompanha a imagem que está ali: com o logo da org, legendar com o
    // nome do revendedor descreveria a marca errada para quem usa leitor de tela.
    expect(imagem().getAttribute("alt")).toBe("Loja da Ana");
  });

  it("logo VAZIO na organização cai para o da instalação, não apaga a marca", () => {
    // O caso que separa `||` de `??`. Vazio é AUSÊNCIA — a mesma regra que
    // `resolveBranding` e `primeiroDefinido` aplicam nas camadas de baixo. Com
    // `??`, `""` venceria a camada de cima e a barra cairia no TEXTO, apagando o
    // logo do revendedor por causa de um campo em branco.
    marcaDaInstalacao = { ...marcaDaInstalacao, logoUrl: LOGO_DA_INSTALACAO };
    contexto = { user: usuario, activeOrg: { ...org, marca: { logoUrl: "" } } };
    renderSidebar({ collapsed: false });

    expect(imagem().getAttribute("src")).toBe(LOGO_DA_INSTALACAO);
  });

  it("sem logo nenhum, continua sendo o nome — não uma imagem quebrada", () => {
    // Guarda de vacuidade dos três de cima: se a barra desenhasse `<img>` sempre,
    // com `src` vazio, todos passariam pelo `getByRole("img")` e o produto
    // mostraria o ícone de imagem quebrada em toda instalação de fábrica.
    contexto = { user: usuario, activeOrg: org };
    renderSidebar({ collapsed: false });

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Sistema do Revendedor")).toBeTruthy();
  });
});

/**
 * O SÍMBOLO RECOLHIDO — e a fronteira que separa a nossa marca da de quem
 * hospeda.
 *
 * POR QUE ESTE BLOCO EXISTE: a barra estreita mostrava uma LETRA (o ladrilho
 * com a inicial da marca), e o dono do produto pediu o símbolo do CRM ali. A
 * peça é a mesma nos dois casos e a diferença é uma condição — que é
 * exatamente o tipo de coisa que passa a valer sempre num "conserto" futuro.
 *
 * ⚠️ O MODO DE FALHA QUE ESTES CASOS GUARDAM É O WHITE-LABEL, não o desenho.
 * A imagem Docker é UMA para todas as marcas (`docs/doctrine/packaging.md`):
 * um símbolo servido incondicionalmente poria o disco "GC" na barra de todo
 * revendedor, e o defeito seria invisível aqui, no CI e na Vercel — só
 * apareceria na VPS de quem a feature de marca existe para servir. É o mesmo
 * modo de falha que `lib/branding.ts` documenta para `NEXT_PUBLIC_*`.
 *
 * `collapsed: true` em todos: expandida, o wordmark ocupa o topo e o CSS
 * esconde o ladrilho — os dois nós existem no DOM e quem escolhe é a folha de
 * estilo, que não roda aqui. O que estes casos medem é QUAL DOS DOIS o
 * componente montou.
 */
describe("o símbolo da barra recolhida", () => {
  afterEach(() => {
    marcaDaInstalacao = { name: "Sistema do Revendedor", logoUrl: null, initial: "S" };
  });

  it("instalação de fábrica: desenha o símbolo do produto, não uma letra", () => {
    marcaDaInstalacao = {
      name: DEFAULT_APP_NAME,
      logoUrl: LOGO_PADRAO_DO_PRODUTO,
      initial: "G",
    };
    contexto = { user: usuario, activeOrg: { ...org, marca: undefined } };
    renderSidebar({ collapsed: true });

    const simbolo = document.querySelector(".nav-marca-simbolo");
    expect(simbolo?.tagName).toBe("IMG");
    expect(simbolo?.getAttribute("src")).toBe(SIMBOLO_PADRAO_DO_PRODUTO);
  });

  it("o nome do produto em CAIXA ALTA continua sendo o produto", () => {
    // ⚠️ CASO MEDIDO NUMA INSTALAÇÃO REAL, e ele é o motivo de a comparação ser
    // normalizada. `platform_branding.app_name` é um campo que o operador
    // DIGITA em /admin/marca, e a instalação de referência do produto tem lá
    // "GESTALT CRM". Comparando byte a byte, ela seria classificada como marca
    // de terceiro e perderia o símbolo — o produto se tratando como revendedor
    // de si mesmo. Foi assim que o defeito apareceu: `/icon` devolveu 1038
    // bytes (o ladrilho desenhado) em vez dos bytes do disco.
    marcaDaInstalacao = { name: "GESTALT CRM", logoUrl: null, initial: "G" };
    contexto = { user: usuario, activeOrg: { ...org, marca: undefined } };
    renderSidebar({ collapsed: true });

    const simbolo = document.querySelector(".nav-marca-simbolo");
    expect(simbolo?.tagName).toBe("IMG");
    expect(simbolo?.getAttribute("src")).toBe(SIMBOLO_PADRAO_DO_PRODUTO);
  });

  it("revendedor com logo próprio: volta a ser o ladrilho da inicial DELE", () => {
    marcaDaInstalacao = {
      name: "Sistema do Revendedor",
      logoUrl: "https://cdn.exemplo.test/revendedor.png",
      initial: "S",
    };
    contexto = { user: usuario, activeOrg: { ...org, marca: undefined } };
    renderSidebar({ collapsed: true });

    const simbolo = document.querySelector(".nav-marca-simbolo");
    expect(simbolo?.tagName).toBe("SPAN");
    expect(simbolo?.textContent).toBe("S");
  });

  it("revendedor que configurou SÓ O NOME também não recebe o nosso símbolo", () => {
    // O caso que separa "a marca é nossa?" de "o logo em vigor é o nosso?".
    // Sem nome próprio configurado, o logo que vale ainda é o do produto — uma
    // condição escrita só sobre o logo deixaria o disco "GC" na barra de quem
    // rebatizou o sistema, que é o vazamento de marca mais fácil de não ver.
    marcaDaInstalacao = { name: "Vendas Turbo", logoUrl: null, initial: "V" };
    contexto = { user: usuario, activeOrg: { ...org, marca: undefined } };
    renderSidebar({ collapsed: true });

    const simbolo = document.querySelector(".nav-marca-simbolo");
    expect(simbolo?.tagName).toBe("SPAN");
    expect(simbolo?.textContent).toBe("V");
  });

  it("organização com marca própria dentro de uma instalação de fábrica: a letra dela", () => {
    // A camada de cima da pilha. A instalação é a nossa, mas quem está na tela
    // é a marca da organização — e o topo da barra já mostra o nome DELA.
    marcaDaInstalacao = {
      name: DEFAULT_APP_NAME,
      logoUrl: LOGO_PADRAO_DO_PRODUTO,
      initial: "G",
    };
    contexto = {
      user: usuario,
      activeOrg: { ...org, marca: { nome: "Loja da Ana", logoUrl: null } },
    };
    renderSidebar({ collapsed: true });

    const simbolo = document.querySelector(".nav-marca-simbolo");
    expect(simbolo?.tagName).toBe("SPAN");
    expect(simbolo?.textContent).toBe("L");
  });
});
