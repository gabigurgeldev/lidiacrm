/**
 * PROVA PELA TELA da casca redesenhada — login real, app real, medida por
 * ferramenta.
 *
 * ── Por que esta sonda existe, e o que ela NÃO é ─────────────────────────────
 *
 * A doutrina de QA Visual do `CLAUDE.md` pede o fluxo como um leigo o faria, num
 * ambiente estilo VPS fresca. Esta sonda **não** é isso, e a diferença está
 * declarada: ela roda contra o `next dev` local apontando para o Supabase da
 * VPS, com uma conta que já existe. Ambiente fresco (baseline + bootstrap-owner
 * + WAHA + Redis) não sobe nesta máquina — não há Docker nem CLI do Supabase no
 * Windows. O que roda em ambiente de verdade é `tests/e2e/navegacao.spec.ts`, no
 * CI.
 *
 * O que ela acrescenta ao que já é medido em unidade: geometria e visibilidade
 * REAIS, com CSS compilado e navegador de verdade, nos quatro tamanhos. Teste de
 * componente não enxerga `display: none` vindo de uma `@media`, e é exatamente
 * aí que mora a metade das afirmações desta onda.
 *
 * ⚠️ MEDIDA POR FERRAMENTA, NUNCA A OLHO: `getBoundingClientRect` e
 * `getComputedStyle`. Um screenshot prova que não quebrou; ele não prova que a
 * barra tem 264px.
 *
 * Uso: `npx tsx tests/sonda-casca-nova.ts` com o `next dev` de pé em :3000.
 */
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SONDA_BASE ?? "http://localhost:3000";
const EMAIL = process.env.OWNER_EMAIL ?? "";
const SENHA = process.env.OWNER_PASSWORD ?? "";
const EVIDENCIA = ".superpowers/evidence/casca-nova";

/** Contrato: `InboxLayout` e `FlowBuilder` subtraem este número à mão. */
const ALTURA_DO_CABECALHO = 56;

const falhas: string[] = [];
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "  ok    " : "  FALHA "}${msg}`);
  if (!cond) falhas.push(msg);
}

/**
 * Preenche e CONFERE que o valor ficou.
 *
 * ⚠️ Um `fill` só não basta nesta tela, e o modo de falha é traiçoeiro: o
 * `domcontentloaded` dispara antes de o React hidratar, e a hidratação devolve
 * o input controlado ao estado inicial — VAZIO. O formulário então recusa com
 * "Email inválido", que parece senha errada e é corrida de hidratação. Medido
 * aqui: o mesmo roteiro passou uma vez e falhou nas seguintes.
 */
async function preencher(page: Page, campo: ReturnType<Page["getByLabel"]>, valor: string) {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    await campo.fill(valor);
    if ((await campo.inputValue()) === valor) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`o campo não segurou o valor depois de 10 tentativas (hidratação?)`);
}

async function entrar(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const botao = page.getByRole("button", { name: /^Entrar$/ });
  await botao.waitFor({ state: "visible", timeout: 60_000 });
  await preencher(page, page.getByLabel(/e-?mail/i), EMAIL);
  await preencher(page, page.getByLabel(/senha/i).first(), SENHA);
  await botao.click();
  // ⚠️ NÃO use `page.waitForURL` aqui — medido, ele estoura nos dois modos
  // (`load` e `commit`) enquanto a navegação acontece de verdade.
  //
  // O `redirect()` da Server Action é navegação do ROTEADOR, do lado do
  // cliente: não há documento novo, então não há `commit` nem `load` para
  // esperar. Quem enxerga isso é o próprio `location`, e é nele que se espera.
  try {
    await page.waitForFunction(() => location.pathname.startsWith("/app"), null, {
      timeout: 180_000,
    });
  } catch (e) {
    // Falhar dizendo O QUE a tela mostrava. Sem isto, todo problema de login
    // (senha errada, limite de tentativas, MFA) vira o mesmo "timeout", e a
    // primeira suspeita vai para o seletor — que é onde menos vezes está.
    const texto = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`não entrou. url=${page.url()} · tela="${texto}"`, { cause: e });
  }
  // O primeiro render do app compila sob demanda no `next dev`; esperar a barra
  // é esperar a casca, não um tempo arbitrário.
  await page.locator("aside.app-sidebar").waitFor({ state: "attached", timeout: 180_000 });

  /**
   * ⚠️ SAIR DO INBOX antes de medir, e este desvio custou uma rodada inteira.
   *
   * O login cai em `/app/inbox`, que é a ÚNICA rota onde a casca esconde o
   * cabeçalho a partir de `md` (`lib/navigation/casca.ts` — lá a lista de
   * conversas precisa da altura inteira). Medindo ali, o cabeçalho dá 0px em
   * 1440, 1280 e 820, e 56px só no celular, onde ele volta porque é quem
   * carrega o ☰.
   *
   * Isso é o produto CERTO e a medida ERRADA: a sonda estava perguntando a
   * altura do cabeçalho na tela que não tem cabeçalho. Contatos é uma rota
   * comum, com a casca completa.
   */
  await page.goto(`${BASE}/app/contacts`, { waitUntil: "domcontentloaded" });
  await page.locator("header.app-header").waitFor({ state: "attached", timeout: 180_000 });
}

async function medir(page: Page, largura: number, altura: number, rotulo: string) {
  await page.setViewportSize({ width: largura, height: altura });
  await page.waitForTimeout(300);

  /**
   * ⚠️ NADA de função nomeada (nem arrow em `const`) DENTRO do `evaluate`.
   *
   * O `tsx`/esbuild compila com `keepNames`, o que injeta uma chamada ao helper
   * `__name` em toda função declarada. O corpo do `evaluate` é serializado e
   * executado NO NAVEGADOR, onde esse helper não existe: o erro que sai é
   * `ReferenceError: __name is not defined`, apontando para a linha do
   * `evaluate` e não para a causa. Por isso tudo aqui é expressão direta.
   */
  const m = await page.evaluate(() => {
    const elBarra = document.querySelector("aside.app-sidebar");
    const elCabecalho = document.querySelector("header.app-header");
    const elLogo = document.querySelector(".nav-logo");
    const elSimbolo = document.querySelector(".nav-marca-simbolo");
    const elBusca = document.querySelector('[data-testid="busca-global"]');
    const cxBarra = elBarra ? elBarra.getBoundingClientRect() : null;
    const cxCabecalho = elCabecalho ? elCabecalho.getBoundingClientRect() : null;
    const cxLogo = elLogo ? elLogo.getBoundingClientRect() : null;
    const cxSimbolo = elSimbolo ? elSimbolo.getBoundingClientRect() : null;
    const cxBusca = elBusca ? elBusca.getBoundingClientRect() : null;
    const elIcone = document.querySelector(".nav-item .nav-icone");
    return {
      barra: cxBarra ? { w: cxBarra.width, h: cxBarra.height } : null,
      cabecalho: cxCabecalho ? { h: cxCabecalho.height } : null,
      logo: cxLogo ? { w: cxLogo.width, h: cxLogo.height } : null,
      simbolo: cxSimbolo ? { w: cxSimbolo.width, h: cxSimbolo.height } : null,
      busca: cxBusca ? { h: cxBusca.height } : null,
      displayLogo: elLogo ? getComputedStyle(elLogo).display : null,
      displaySimbolo: elSimbolo ? getComputedStyle(elSimbolo).display : null,
      raioDaBusca: elBusca ? getComputedStyle(elBusca).borderTopLeftRadius : null,
      temConta: !!document.querySelector('[data-testid="acoes-de-conta-na-barra"]'),
      // As TRÊS ausências que esta onda criou. Medi-las é o que impede que
      // voltem em silêncio num redesenho futuro.
      temCaminho: !!document.querySelector('nav[aria-label="Você está em"]'),
      temIdioma: !!document.querySelector('[data-testid="seletor-de-idioma"]'),
      contas: document.querySelectorAll('[aria-label="Menu do usuário"]').length,
      nosDoIcone: elIcone ? elIcone.querySelectorAll("path,rect,circle,line").length : 0,
      rolagemH: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  console.log(`\n── ${rotulo} (${largura}×${altura}) ──`);
  const { barra, cabecalho, logo, simbolo } = m;

  if (cabecalho) {
    ok(
      Math.round(cabecalho.h) === ALTURA_DO_CABECALHO,
      `cabeçalho tem ${Math.round(cabecalho.h)}px (contrato: ${ALTURA_DO_CABECALHO})`,
    );
  }

  // ── As três ausências ──────────────────────────────────────────────────────
  ok(!m.temCaminho, "o cabeçalho NÃO tem o caminho da página");
  ok(!m.temIdioma, "o cabeçalho NÃO tem seletor de idioma");
  // Uma só: no celular a gaveta está fechada, então o nó dela não conta.
  ok(
    m.contas === 1,
    `a conta existe exatamente UMA vez (achei ${m.contas})`,
  );

  if (largura >= 768) {
    if (!barra) throw new Error(`a barra sumiu em ${largura}px, onde deveria existir`);
    const estreita = largura <= 1023;
    ok(
      Math.round(barra.w) === (estreita ? 72 : 264),
      `barra com ${Math.round(barra.w)}px (esperado ${estreita ? 72 : 264})`,
    );
    // A alternância da marca — a peça que substituiu o recorte por `cover`.
    ok(
      (m.displayLogo === "none") === estreita,
      `wordmark ${m.displayLogo} (barra estreita = ${estreita})`,
    );
    ok(
      (m.displaySimbolo !== "none") === estreita,
      `ladrilho ${m.displaySimbolo} (barra estreita = ${estreita})`,
    );
    if (!estreita && logo) {
      ok(logo.h <= 24, `logo com ${Math.round(logo.h)}px de altura (teto: 24)`);
      /**
       * ⚠️ A RÉGUA AQUI É O TETO DECLARADO (`--nav-logo max-width: 8.5rem` =
       * 136px), e não "metade da barra".
       *
       * A primeira versão desta linha usava `barra.w / 2` = 132px e reprovou
       * por 4px — com o CSS certo. Régua inventada na sonda, mais apertada que
       * o contrato, acusa o produto de um defeito que é da medida.
       *
       * O que importa provar é que o teto está EM VIGOR no navegador: era 224px
       * com `h-8`, e o logo virava o elemento mais pesado da tela. A segunda
       * asserção guarda essa redução para que "afrouxar um pouquinho" precise
       * passar por aqui.
       */
      ok(logo.w <= 136, `logo ocupa ${Math.round(logo.w)}px (teto de 8.5rem = 136)`);
      ok(logo.w < 200, `e está bem abaixo dos ~223px de antes (${Math.round(logo.w)}px)`);
    }
    if (estreita && simbolo) {
      ok(
        Math.round(simbolo.w) === 32 && Math.round(simbolo.h) === 32,
        `ladrilho de ${Math.round(simbolo.w)}×${Math.round(simbolo.h)}px`,
      );
    }
    ok(m.temConta, "a conta está no rodapé da barra");
  }

  // A busca LARGA é `hidden md:flex` — no celular quem aparece é a lupa, e
  // medir a caixa aqui devolveria zero por desenho. O raio vale nos dois: ele
  // vem da mesma classe.
  if (m.busca && largura >= 768) {
    ok(Math.round(m.busca.h) === 40, `busca com ${Math.round(m.busca.h)}px de altura`);
  }
  ok(m.raioDaBusca === "14px", `raio da busca = ${m.raioDaBusca} (linguagem do login)`);

  ok(!m.rolagemH, "sem rolagem horizontal");
  console.log(`  ·     nós no ícone do menu: ${m.nosDoIcone} (duotone desenha 2+)`);

  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `casca-${largura}.png`), fullPage: false });
}

async function main() {
  if (!EMAIL || !SENHA) throw new Error("faltam OWNER_EMAIL / OWNER_PASSWORD no ambiente");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await entrar(page);
    console.log(`entrou — ${page.url()}`);
    await medir(page, 1440, 900, "laptop grande");
    await medir(page, 1280, 768, "notebook comum");
    await medir(page, 820, 1180, "tablet — barra compacta por CSS");
    await medir(page, 390, 844, "celular");
  } finally {
    await browser.close();
  }

  console.log(`\n${falhas.length === 0 ? "TUDO OK" : `${falhas.length} FALHA(S)`}`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

void main();
