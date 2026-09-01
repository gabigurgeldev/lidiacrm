/**
 * Navegação agrupada e RECOLHÍVEL — prova pela TELA (DoD item 12).
 *
 * Os testes unitários provam que o registro e os componentes fazem o que
 * dizem. Isto prova o que o usuário reclamou: que dá para *achar* as coisas.
 * O caso que originou a mudança é o primeiro — chegar em Funis sem saber que
 * ele morava em Configurações.
 *
 * ⚠️ ESTA SPEC CARREGA UMA PROVA QUE SÓ ELA CONSEGUE DAR. Grupo fechado esconde
 * os itens com `visibility: hidden`, e barra estreita esconde os rótulos com
 * `display: none` — as duas coisas vivem numa folha de estilo, e o jsdom não
 * aplica folha de estilo nenhuma. No teste de componente os links continuam no
 * DOM e continuam sendo achados: um teste de lá afirmando "sumiu" seria
 * falha-em-verde. Aqui a medida é `getComputedStyle`, no navegador de verdade.
 *
 * Pré-requisito: `.e2e-creds.json` (gerado por scripts/seed-e2e-credentials.ts).
 */
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { afirmarAdminDeTenantPuro } from "./utils/precondicao";

let creds = lerCreds();
const EVIDENCE = path.join(process.cwd(), ".superpowers", "evidence");

mkdirSync(EVIDENCE, { recursive: true });

// ── Precondição de identidade ────────────────────────────────────────────────
// O menu é `sidebarGroups(isPlatformAdmin, role)`, então a suspeita natural é
// que promover o `e2e-admin` a dono do servidor inflasse o sidebar que esta spec
// mede item a item.
//
// ⚠️ MEDIDO, e a suspeita não se confirma: `canSee` é
// `isPlatformAdmin || ROLE_RANK[role] >= ROLE_RANK[minRole]`; `ROLE_RANK.admin`
// é 5, o TETO, e o maior `minRole` do registro é `"admin"`. Para um admin de
// tenant o menu é IDÊNTICO promovido ou não — as asserções de `toHaveText`
// abaixo não mudariam. Guardar a identidade aqui continua valendo (é a spec de
// navegação; qualquer destino futuro exclusivo do dono apareceria primeiro
// nela), mas registrar a diferença entre "muda" e "poderia mudar" é o ponto.
test.beforeAll(async () => {
  await afirmarAdminDeTenantPuro(creds.users.admin!.email);
});

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

async function loginAdmin(page: Page): Promise<void> {
  creds = await loginComoAdmin(page, creds);
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

/**
 * Abre um grupo do menu, se ele já não estiver aberto.
 *
 * ⚠️ NÃO É AÇOUGUE DE TESTE, é o produto: desde o redesenho, só o grupo da tela
 * em que se está nasce aberto. Um clique direto num item de outro grupo falharia
 * com "element is not visible" — e a mensagem esconderia a causa, que é ele
 * estar fechado. O `if` existe porque abrir duas vezes FECHA.
 */
async function abrirGrupo(page: Page, nome: string): Promise<void> {
  const botao = sidebar(page).getByRole("button", { name: nome, exact: true });
  if ((await botao.getAttribute("aria-expanded")) !== "true") await botao.click();
}

async function expectSemOverflowHorizontal(page: Page, contexto: string): Promise<void> {
  const m = await page.evaluate(() => ({
    // ⚠️ `body.scrollWidth`, NÃO `documentElement`. `app/globals.css` põe
    // `overflow-x: hidden` em `html` E em `body`, e sob isso o `scrollWidth` do
    // `documentElement` é GRAMPEADO no `clientWidth`: a conta dá zero mesmo com
    // um filho de 3000px dentro. Medido com o chromium do repo, viewport
    // 390x844, filho de 3000px — `visible` → 2610, `hidden` → 0, e
    // `body.scrollWidth` = 3000 nos DOIS casos.
    //
    // A asserção existia e era incapaz de falhar. Trocar a medida é o conserto.
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    m.scrollWidth,
    `${contexto}: body.scrollWidth (${m.scrollWidth}) não pode passar do clientWidth (${m.clientWidth})`,
  ).toBeLessThanOrEqual(m.clientWidth + 1);
}

// `loginComoAdmin` espera a virada da janela TOTP entre logins consecutivos
// (o servidor recusa código repetido), e essa espera sozinha pode consumir os
// 30 s do teto global do playwright.config.ts.
test.describe.configure({ timeout: 120_000 });

test.describe("navegação agrupada", () => {
  test("o sidebar tem hierarquia: grupos na ordem de uso", async ({ page }) => {
    await loginAdmin(page);

    // Organização não aparece como título aqui: seu hub (Configurações) vive no
    // rodapé fixo — ver o teste de dobra abaixo.
    //
    // ⚠️ O TÍTULO CONTINUA SENDO `heading`, e virou TAMBÉM um botão: o cabeçalho
    // é `<h2><button aria-expanded></h2>`. As duas coisas de propósito — o botão
    // é o controle que recolhe, o heading é o que mantém a barra navegável por
    // cabeçalho no leitor de tela.
    const titulos = sidebar(page).getByRole("heading");
    await expect(titulos).toHaveText([
      "Atendimento",
      "CRM",
      "Inteligência Artificial",
      "Canais",
      "Análise",
    ]);

    await page.screenshot({
      path: path.join(EVIDENCE, "nav-sidebar-agrupado.png"),
      fullPage: true,
    });
  });

  test("um grupo fechado ESCONDE os itens — medido, não presumido", async ({ page }) => {
    await loginAdmin(page);

    // A rota depois do login é o Inbox, então Atendimento nasce aberto e CRM
    // nasce fechado. Esta é a asserção que o teste de componente não consegue
    // fazer: no jsdom o link continua "visível" porque não há CSS.
    const estado = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegação principal"]')!;
      const link = [...nav.querySelectorAll("a")].find((a) => a.textContent?.trim() === "Funis");
      const corpo = link?.closest(".nav-grupo-corpo");
      return {
        achouOLink: Boolean(link),
        visibilidade: corpo ? getComputedStyle(corpo).visibility : "sem-corpo",
        altura: corpo ? Math.round(corpo.getBoundingClientRect().height) : -1,
      };
    });

    expect(estado.achouOLink, "o link tem de existir no DOM — o que muda é ele ser alcançável").toBe(true);
    expect(estado.visibilidade).toBe("hidden");
    expect(estado.altura).toBe(0);

    await abrirGrupo(page, "CRM");
    await expect(sidebar(page).getByRole("link", { name: "Funis", exact: true })).toBeVisible();
  });

  test("chega nas Etapas do funil pelo CRM, sem passar por Configurações", async ({ page }) => {
    await loginAdmin(page);

    // O caso que originou tudo: o usuário não sabia que esta tela existia.
    //
    // ⚠️ O ITEM MUDOU DE NOME, e o nome antigo ("Funis") passou para o VIZINHO —
    // a lista de funis, em /app/kanban. Um teste que continuasse clicando em
    // "Funis" seguiria verde medindo a outra tela; por isso a asserção de URL
    // abaixo é específica (`settings/tenant/pipelines`) e não o antigo
    // /pipelines/, que casa com as duas.
    await abrirGrupo(page, "CRM");
    await sidebar(page).getByRole("link", { name: "Etapas do funil" }).click();
    await page.waitForURL(/settings\/tenant\/pipelines/);
    await expect(page.getByRole("heading", { name: "Etapas do funil", level: 1 })).toBeVisible();

    // O grupo da tela em que se está abre sozinho: chegar aqui por link direto
    // não pode deixar a barra sem nenhuma marca de onde se está.
    await expect(
      sidebar(page).getByRole("button", { name: "CRM", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("e a lista de funis é o item vizinho, com nome próprio", async ({ page }) => {
    await loginAdmin(page);
    await abrirGrupo(page, "CRM");
    await sidebar(page).getByRole("link", { name: "Funis", exact: true }).click();
    await page.waitForURL(/\/app\/kanban/);
    await expect(page.getByRole("heading", { name: "Funis", level: 1 })).toBeVisible();
  });

  test("chega em Conhecimento, que só existia atrás das abas de IA", async ({ page }) => {
    await loginAdmin(page);

    // ⚠️ O rótulo do hub era "Ver tudo em IA". Virou "Central de IA": com o
    // cabeçalho do grupo agora clicável, "Ver tudo em X" descrevia o gesto que o
    // próprio cabeçalho passou a fazer.
    await abrirGrupo(page, "Inteligência Artificial");
    await sidebar(page).getByRole("link", { name: "Central de IA" }).click();
    await page.waitForURL(/\/app\/ai$/);

    // O hub organiza por jornada, não numa grade solta.
    await expect(page.getByRole("heading", { name: "Montar o agente" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ensinar o agente" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acompanhar o agente" })).toBeVisible();

    await page.screenshot({ path: path.join(EVIDENCE, "nav-hub-ia.png"), fullPage: true });

    await page.getByRole("link", { name: /Conhecimento/ }).click();
    await page.waitForURL(/knowledge\/sources/);
  });

  /**
   * O canal oficial saiu de Configurações no PR #105 e virou aba de Conexões.
   * A porta, portanto, é Conexões — que agora vive no grupo CANAIS do sidebar,
   * e não mais como um card perdido em Configurações.
   */
  test("chega ao canal oficial pelo grupo Canais, não por Configurações", async ({ page }) => {
    await loginAdmin(page);

    await abrirGrupo(page, "Canais");
    await sidebar(page).getByRole("link", { name: "Conexões" }).click();
    await page.waitForURL(/\/app\/connections/);
    await expect(page.getByRole("tab", { name: /oficial/i })).toBeVisible();
  });

  test("o arranjo dos grupos sobrevive ao F5", async ({ page }) => {
    // A promessa inteira da persistência. Sem o cookie lido no SSR, o servidor
    // pintaria tudo aberto e o navegador fecharia meio segundo depois — o
    // arranjo voltaria de fábrica em toda navegação de página inteira.
    await loginAdmin(page);

    await abrirGrupo(page, "Canais");
    const atendimento = sidebar(page).getByRole("button", { name: "Atendimento", exact: true });
    await atendimento.click(); // fecha o grupo da rota atual, dentro da sessão

    await page.reload();

    await expect(
      sidebar(page).getByRole("button", { name: "Canais", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    // Atendimento volta ABERTO, e é o comportamento certo: é o grupo da tela em
    // que se está, e o item aceso precisa ser visível. Fechá-lo vale enquanto se
    // está nela; o carregamento seguinte reabre.
    await expect(atendimento).toHaveAttribute("aria-expanded", "true");
  });

  test("o ⌘K acha o canal oficial por nome, mesmo sem tela própria", async ({ page }) => {
    await loginAdmin(page);

    // Ninguém procura por "Conexões" quando quer o número oficial da Meta —
    // procura por "oficial". A busca varre a descrição além do rótulo.
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill("oficial");
    await expect(page.getByRole("option", { name: /Conexões/ })).toBeVisible();
  });

  test("⌘K abre, filtra e navega", async ({ page }) => {
    await loginAdmin(page);

    await page.keyboard.press("ControlOrMeta+k");
    const busca = page.getByRole("combobox");
    await expect(busca).toBeVisible();

    await busca.fill("conhec");
    await expect(page.getByRole("option", { name: /Conhecimento/ })).toBeVisible();

    await page.screenshot({ path: path.join(EVIDENCE, "nav-command-palette.png") });

    await page.keyboard.press("Enter");
    await page.waitForURL(/knowledge\/sources/);

    // Chegar por atalho ABRE o grupo do destino: sem isto, quem usa o ⌘K
    // aterrissa numa tela cuja marca de posição está escondida dentro de um
    // grupo fechado, e descobrir onde está exigiria abrir grupo por grupo.
    await expect(
      sidebar(page).getByRole("button", { name: "Inteligência Artificial", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  /**
   * Agrupar cria um risco que a lista plana não tinha: o menu cresce e passa a
   * exigir scroll. Na primeira versão da reorganização, medido em 1280×768, o
   * conteúdo dava 1019px contra 663px visíveis — SETE links e os grupos Análise
   * e Organização ficavam fora da dobra.
   *
   * ⚠️ A ASSERÇÃO MUDOU, e a mudança é o ponto do redesenho. Antes ela dizia
   * "em 900px o menu inteiro tem de caber sem scroll", com TODOS os itens
   * abertos — e era essa exigência que impedia telas novas de entrar no menu
   * (duas a mais estouravam a dobra, e por isso Provedores e Marca ficaram só no
   * hub). Com os grupos recolhíveis, o menu aberto INTEIRO não precisa mais
   * caber: o que precisa caber é a lista de CABEÇALHOS, que é o mapa. É por isso
   * que o produto pode voltar a crescer.
   *
   * Medido por ferramenta, nunca a olho.
   */
  test("todos os cabeçalhos de grupo cabem na dobra, em 1280×768", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 768 });
    await loginAdmin(page);

    const m = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegação principal"]')!;
      const r = nav.getBoundingClientRect();
      return {
        rola: nav.scrollHeight > Math.round(r.height) + 1,
        titulosFora: [...nav.querySelectorAll("h2")].filter(
          (h) => h.getBoundingClientRect().bottom > r.bottom,
        ).length,
        quantosTitulos: nav.querySelectorAll("h2").length,
      };
    });

    expect(m.quantosTitulos, "guarda de vacuidade: sem títulos, 'nenhum fora' é vazio").toBe(5);
    expect(m.titulosFora, "grupo inteiro invisível é o problema que viemos resolver").toBe(0);
    expect(m.rola, "no arranjo de fábrica o mapa inteiro cabe sem scroll").toBe(false);
  });

  test("com TUDO aberto o menu rola, e o rodapé continua fora da rolagem", async ({ page }) => {
    // O pior caso, que é o estado antigo do produto. Ele PODE rolar agora — a
    // saída é recolher. O que não pode é Configurações depender dessa rolagem.
    await page.setViewportSize({ width: 1280, height: 768 });
    await loginAdmin(page);

    for (const g of ["CRM", "Inteligência Artificial", "Canais", "Análise"]) {
      await abrirGrupo(page, g);
    }

    const config = page.getByRole("link", { name: "Configurações" });
    await expect(config).toBeVisible();

    const dentroDaNav = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegação principal"]')!;
      const link = [...document.querySelectorAll("a")].find(
        (a) => a.textContent?.trim() === "Configurações",
      );
      return nav.contains(link!);
    });
    expect(dentroDaNav, "Configurações não pode depender de scroll para aparecer").toBe(false);

    await page.screenshot({
      path: path.join(EVIDENCE, "nav-sidebar-tudo-aberto.png"),
      fullPage: true,
    });
  });

  test("a seta para baixo PULA o que está dentro de grupo fechado", async ({ page }) => {
    // O defeito que só existe no navegador: item de grupo fechado tem
    // `visibility: hidden`, que o esconde SEM tirá-lo do layout. Ele entrava na
    // lista de focáveis, e como elemento invisível não recebe foco, a seta para
    // baixo parava de funcionar ao chegar no primeiro grupo fechado — sem erro,
    // sem aviso. No jsdom isso é invisível: lá não há CSS, e todo item parece
    // focável.
    await loginAdmin(page);

    // Atendimento (aberto, é a rota) → último item dele → o cabeçalho de CRM,
    // que está FECHADO. A tecla seguinte tem de pular os filhos dele.
    await sidebar(page).getByRole("button", { name: "CRM", exact: true }).focus();
    await page.keyboard.press("ArrowDown");

    const focado = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        texto: el?.textContent?.trim() ?? null,
        visivel: el ? getComputedStyle(el).visibility : null,
      };
    });

    expect(focado.visivel, "o foco nunca pode parar num elemento invisível").toBe("visible");
    expect(focado.texto, "depois de CRM fechado vem o próximo grupo, não um filho dele").toBe(
      "Inteligência Artificial",
    );
  });

  test("o item ativo se marca sem virar um bloco chapado", async ({ page }) => {
    // A queixa era o verde ocupando a linha inteira. O estado ativo agora são
    // três sinais fracos somados — fundo a 12% da accent, ícone na accent cheia e
    // uma marca de 3px na borda. Medido: o fundo tem de ser TRANSLÚCIDO (o
    // `color-mix` devolve `rgba` com alfa < 1), não a cor sólida.
    await loginAdmin(page);

    const m = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegação principal"]')!;
      const ativo = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!ativo) return null;
      const marca = getComputedStyle(ativo, "::before");
      return {
        fundo: getComputedStyle(ativo).backgroundColor,
        larguraDaMarca: marca.width,
        altura: Math.round(ativo.getBoundingClientRect().height),
      };
    });

    expect(m, "sem item aceso não há o que medir").not.toBeNull();
    // ⚠️ A REGRA É "TEM ALFA", não "é `rgba`". Medido no chromium do repo: o
    // `color-mix(in oklab, …)` computa para `oklab(0.67182 -0.049 0.045 / 0.12)`
    // — um teste que exigisse `rgba(...)` reprovaria uma implementação correta.
    expect(m!.fundo, `fundo do item ativo (${m!.fundo}) tem de ser translúcido`).toMatch(
      /[/,]\s*0?\.\d+\s*\)$/,
    );
    expect(m!.larguraDaMarca).toBe("3px");
    // A altura pedida foi 40–44px. Sem esta medida, um `min-height` perdido no
    // caminho passaria despercebido — item alto demais é a queixa de densidade.
    expect(m!.altura).toBeGreaterThanOrEqual(40);
    expect(m!.altura).toBeLessThanOrEqual(44);
  });

  test.describe("tablet", () => {
    test.use({ viewport: { width: 820, height: 1180 } });

    test("em 820px a barra compacta SOZINHA, sem tocar na preferência", async ({ page }) => {
      // A faixa 768–1023 é a única em que a largura da barra não sai do cookie.
      // O cookie é a preferência de quem usa o laptop; deixá-lo decidir aqui
      // faria o iPad reescrever como a barra abre no notebook da mesma pessoa.
      await loginAdmin(page);

      const m = await page.evaluate(() => {
        const aside = document.querySelector<HTMLElement>("aside.app-sidebar");
        if (!aside) return null;
        const rotulo = aside.querySelector<HTMLElement>(".nav-rotulo");
        return {
          preferencia: aside.getAttribute("data-collapsed"),
          largura: Math.round(aside.getBoundingClientRect().width),
          rotulo: rotulo ? getComputedStyle(rotulo).display : "sem-rotulo",
        };
      });

      expect(m).not.toBeNull();
      expect(m!.preferencia, "o cookie continua dizendo expandida").toBe("false");
      expect(m!.largura, "e mesmo assim a barra tem a largura compacta").toBe(72);
      expect(m!.rotulo).toBe("none");

      await expectSemOverflowHorizontal(page, "tablet 820px");
      await page.screenshot({
        path: path.join(EVIDENCE, "nav-tablet-820-compacta.png"),
        fullPage: true,
      });
    });
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("em 390px, o sidebar vira gaveta e não cria overflow horizontal", async ({ page }) => {
      await loginAdmin(page);

      await expect(sidebar(page), "o sidebar desktop fica fora da árvore acessível no mobile").toHaveCount(0);
      await expectSemOverflowHorizontal(page, "shell mobile após login");

      await page.getByRole("button", { name: "Abrir navegação" }).click();
      await expect(sidebar(page)).toBeVisible();
      await expectSemOverflowHorizontal(page, "shell mobile com drawer aberto");
      await page.screenshot({
        path: path.join(EVIDENCE, "nav-mobile-390-drawer-aberta.png"),
        fullPage: true,
      });

      // A gaveta é LARGA: ela não pode herdar a compactação da consulta
      // `max-width: 1023px`, que casa em todo celular.
      const rotulo = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".nav-drawer .nav-rotulo");
        return el ? getComputedStyle(el).display : "sem-rotulo";
      });
      expect(rotulo, "na gaveta o nome de cada tela continua escrito").not.toBe("none");

      await abrirGrupo(page, "CRM");
      await sidebar(page).getByRole("link", { name: "Funis", exact: true }).click();
      await page.waitForURL(/\/app\/kanban/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expectSemOverflowHorizontal(page, "shell mobile após navegar pelo drawer");

      await page.screenshot({
        path: path.join(EVIDENCE, "nav-mobile-390-sem-overflow.png"),
        fullPage: true,
      });
    });
  });

  test("um agent não vê o cabeçalho de um grupo que a permissão esvaziou", async ({ page }) => {
    await login(page, creds.users.agent!.email);

    // CANAIS é todo manager+/admin: o título não pode sobrar sozinho.
    await expect(sidebar(page).getByRole("heading", { name: "Canais" })).toHaveCount(0);
    await expect(sidebar(page).getByRole("heading", { name: "Atendimento" })).toBeVisible();
  });

  test("o cabeçalho diz onde se está, e o caminho vem do registro", async ({ page }) => {
    await loginAdmin(page);

    const caminho = page.getByRole("navigation", { name: "Você está em" });
    await expect(caminho).toContainText("Atendimento");
    await expect(caminho).toContainText("Inbox");

    await abrirGrupo(page, "CRM");
    await sidebar(page).getByRole("link", { name: "Etapas do funil" }).click();
    await page.waitForURL(/settings\/tenant\/pipelines/);
    // A tela mora em CRM ainda que a URL passe por /app/settings — é o caso que
    // um breadcrumb casando pelo primeiro prefixo erraria.
    await expect(caminho).toContainText("CRM");
    await expect(caminho).toContainText("Etapas do funil");

    await page.screenshot({ path: path.join(EVIDENCE, "nav-header-breadcrumb.png") });
  });
});
