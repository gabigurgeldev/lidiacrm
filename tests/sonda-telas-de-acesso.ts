/**
 * Sonda das TELAS DE ACESSO — mede as caixas e as cores, não olha a tela.
 *
 * ═══ O que só esta sonda pode provar ═══
 *
 * `tests/unit/acesso-vidro-contraste.test.ts` prova, por cálculo, que o cartão
 * de vidro é legível sobre QUALQUER cena — ele mede os dois extremos, e todo o
 * resto cai entre eles. O que ele não sabe é se a cena foi realmente desenhada,
 * se ela roda, se ela PARA quando o sistema pede, e se a tela continua usável
 * quando não há WebGL. Isso é comportamento de navegador e só se mede dirigindo
 * um.
 *
 * ⚠️ Medidas por `getBoundingClientRect()` e `getComputedStyle()`, NUNCA a olho
 * nem por comparação de imagem. Os screenshots são anexo para quem for ler
 * depois; a prova são os números.
 *
 * ⚠️ O rótulo flutuante é medido em `#password`, NUNCA em `#email`: o campo de
 * e-mail tem `autoFocus` e já nasce com o rótulo levantado, então medi-lo daria
 * verde sem que animação nenhuma tivesse acontecido.
 *
 * ⚠️ Para matar o servidor depois: `taskkill //PID <pid> //F`. `pkill -f "next
 * start"` NÃO mata o processo no Windows — o servidor velho segura a porta,
 * serve o `.next` trocado por baixo, e esta sonda reprova tudo com valores sem
 * estilo. Já aconteceu, e o diagnóstico custou uma rodada de build inteira.
 *
 * Run:  pnpm build && PORT=3100 pnpm start &
 *       E2E_PORT=3100 npx tsx tests/sonda-telas-de-acesso.ts
 */
import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const PORTA = process.env.E2E_PORT ?? "3100";
const BASE = `http://127.0.0.1:${PORTA}`;
const EVIDENCIA = ".superpowers/evidence";

/** WCAG 1.4.3 (texto AA) — o mesmo piso de `lib/branding/contraste.ts`. */
const PISO_DE_TEXTO = 4.5;
/** Alvo de toque confortável; o campo é 60px e não pode encolher. */
const ALTURA_MINIMA_DO_CAMPO = 48;
/** Piso de opacidade do vidro — doutrina, `--vidro-opacidade`. */
const PISO_DO_VIDRO = 0.8;
/** A cena entra depois do `requestIdleCallback` + import dinâmico do three.
    Teto generoso de propósito: sob GPU de software (o headless usa SwiftShader)
    o primeiro quadro custa caro, e um teto curto reprova por lentidão da
    máquina e não por defeito da tela. */
const ESPERA_DA_CENA = 25_000;

/**
 * ⚠️ O remendo do `__name`, e por que ele não é opcional.
 *
 * O `tsx` compila com esbuild e `keepNames` ligado: toda função declarada dentro
 * de um `page.evaluate(...)` sai embrulhada em `__name(fn, "fn")`, um helper que
 * o esbuild injeta no ESCOPO DO MÓDULO. O Playwright serializa o callback para
 * string e o avalia dentro do navegador, onde esse escopo não existe — e a sonda
 * morre com `ReferenceError: __name is not defined` na primeira medição, sem
 * dizer uma palavra sobre a tela.
 *
 * É `content:` (string) e não uma função de propósito: uma função aqui passaria
 * pelo mesmo compilador e teria o problema que vem consertar.
 */
const REMENDO_DO_ESBUILD = "globalThis.__name = globalThis.__name || ((f) => f);";

/** Conta `requestAnimationFrame` desde ANTES do primeiro quadro da página. */
const CONTADOR_DE_RAF = `${REMENDO_DO_ESBUILD}
  globalThis.__raf = 0;
  var __rafOriginal = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    globalThis.__raf += 1;
    return __rafOriginal(cb);
  };`;

/**
 * Nega WebGL de forma determinística.
 *
 * `--disable-webgl` como argumento de linha de comando não é honrado de forma
 * confiável nas versões recentes do Chromium (ele cai no SwiftShader e o
 * contexto nasce assim mesmo). Negar no `getContext` testa exatamente o caminho
 * que o nosso código percorre: `new WebGLRenderer` lança, o `try/catch` de
 * `CenaDeVidro` marca `sem-webgl`, e o fundo CSS assume.
 */
const SEM_WEBGL = `${REMENDO_DO_ESBUILD}
  var __getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (tipo) {
    if (String(tipo).indexOf('webgl') === 0) return null;
    return __getContext.apply(this, arguments);
  };`;

const falhas: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ok    " : "  FALHA "}${msg}`);
  if (!cond) falhas.push(msg);
};

/** Luminância relativa de uma cor CSS resolvida (`rgb()` / `rgba()`). */
function luminancia(cor: string): number {
  const n = cor.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const [r, g, b] = n.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function razao(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Os canais e o alfa de uma cor CSS resolvida. */
function canais(cor: string): { rgb: [number, number, number]; alfa: number } {
  const n = cor.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return {
    rgb: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0],
    alfa: n.length >= 4 ? (n[3] ?? 1) : 1,
  };
}

/**
 * O PIOR fundo que o cartão pode apresentar: ele composto sobre PRETO.
 *
 * É o mesmo raciocínio do teste unitário, aplicado ao valor que o navegador de
 * fato resolveu. Toda cor de cena real cai entre este composto e o cartão puro,
 * então medir aqui é medir o pior caso de qualquer quadro — inclusive dos que a
 * sonda não viu.
 *
 * ⚠️ A composição é feita com Canvas 2D DENTRO da página, e não com regex aqui.
 * O Chrome serializa `color-mix(in oklab, …)` como `oklab(0.99 0.00 0.00 / 0.86)`,
 * em escala 0–1 — um parser que assuma `rgb()` em 0–255 lê aquilo como
 * `rgb(1, 0, 0)` e mede contraste contra VERMELHO ESCURO. Foi o que aconteceu na
 * primeira rodada desta sonda: o número saiu 1,20:1 e a tela não tinha defeito
 * nenhum. Deixar o navegador parsear é a única forma de não reimplementar CSS
 * Color 4 aqui dentro.
 */
async function piorFundoDoCartao(page: Page, seletor: string): Promise<string> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return "rgb(255, 255, 255)";
    const cor = getComputedStyle(el).backgroundColor;
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return "rgb(255, 255, 255)";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  }, seletor);
}

/** Mede a caixa de um seletor; `null` quando ele não está na tela. */
async function caixa(page: Page, seletor: string) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, seletor);
}

// ── Bloco 1 · geometria e contraste em quatro larguras ──────────────────────

async function geometria(navegador: Browser) {
  for (const largura of [1440, 1024, 768, 390]) {
    const ctx = await navegador.newContext({ viewport: { width: largura, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript({ content: REMENDO_DO_ESBUILD });
    const resposta = await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    if (!resposta?.ok()) throw new Error(`/login respondeu ${resposta?.status()}`);

    console.log(`\n═══ ${largura}px ═══`);

    const m = await page.evaluate(() => {
      const cx = (s: string) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const estilo = (s: string, prop: string) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).getPropertyValue(prop) : null;
      };
      return {
        cartao: cx("main"),
        fundo: cx('[data-prova="fundo-da-cena"]'),
        email: cx("#email"),
        corDoCartao: estilo("main", "background-color"),
        desfoqueDoCartao: estilo("main", "backdrop-filter"),
        corDoTitulo: estilo("h1", "color"),
        corDoSubtitulo: estilo("h1 + p", "color"),
        rolagemHorizontal: document.documentElement.scrollWidth > window.innerWidth,
        marcaDoAmbiente:
          document
            .querySelector("[data-marca-do-ambiente]")
            ?.getAttribute("data-marca-do-ambiente") ?? null,
        textoDoCorpo: document.body.innerText,
      };
    });

    ok(!m.rolagemHorizontal, "sem rolagem horizontal");
    ok(
      (m.email?.h ?? 0) >= ALTURA_MINIMA_DO_CAMPO,
      `#email tem ${Math.round(m.email?.h ?? 0)}px de altura (piso ${ALTURA_MINIMA_DO_CAMPO})`,
    );

    // O cartão cabe na viewport com respiro, em toda largura.
    ok(
      m.cartao !== null && m.cartao.w > 0 && m.cartao.w <= largura,
      `o cartão tem ${Math.round(m.cartao?.w ?? 0)}px e cabe nos ${largura}px`,
    );
    // O fundo é fixo e cobre a tela — ele é o que fica quando não há cena.
    ok(
      (m.fundo?.w ?? 0) >= largura,
      `o fundo cobre a largura (${Math.round(m.fundo?.w ?? 0)} de ${largura})`,
    );

    // Vidro de verdade: translúcido E desfocado. Um dos dois sozinho não é vidro.
    if (m.corDoCartao) {
      const { alfa } = canais(m.corDoCartao);
      ok(
        alfa >= PISO_DO_VIDRO && alfa < 1,
        `o cartão é translúcido no piso da doutrina (alfa ${alfa}, piso ${PISO_DO_VIDRO})`,
      );
    }
    ok(
      Boolean(m.desfoqueDoCartao) && m.desfoqueDoCartao !== "none",
      `o cartão desfoca o que passa atrás (${m.desfoqueDoCartao})`,
    );

    // Contraste medido contra o PIOR composto possível, não contra o que está
    // desenhado agora — a cena se mexe, e um quadro não prova os outros.
    const pior = await piorFundoDoCartao(page, "main");
    for (const [nome, cor] of [
      ["h1", m.corDoTitulo],
      ["h1 + p", m.corDoSubtitulo],
    ] as const) {
      if (!cor) continue;
      const r = razao(cor, pior);
      ok(r >= PISO_DE_TEXTO, `${nome} contrasta ${r.toFixed(2)}:1 no pior caso de cena (${pior})`);
    }

    ok(Boolean(m.marcaDoAmbiente), "data-marca-do-ambiente tem valor");
    if (m.marcaDoAmbiente) {
      ok(
        !m.textoDoCorpo.includes(m.marcaDoAmbiente),
        `o nome "${m.marcaDoAmbiente}" não está escrito na página`,
      );
    }

    await page.screenshot({ path: `${EVIDENCIA}/acesso-${largura}.png`, fullPage: true });
    await ctx.close();
  }
}

// ── Bloco 2 · a cena: existe, roda, para, e sabe faltar ─────────────────────

async function cena(navegador: Browser) {
  console.log("\n═══ a cena de vidro ═══");

  // (a) Movimento normal: o canvas chega e o laço roda.
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript({ content: CONTADOR_DE_RAF });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  let temCanvas = true;
  try {
    await page.waitForSelector(".acesso-cena canvas", { timeout: ESPERA_DA_CENA });
  } catch {
    temCanvas = false;
  }
  ok(temCanvas, "o <canvas> da cena chegou depois da carga preguiçosa");

  if (temCanvas) {
    const tela = await caixa(page, ".acesso-cena canvas");
    ok((tela?.w ?? 0) > 100 && (tela?.h ?? 0) > 100, `o canvas tem área (${Math.round(tela?.w ?? 0)}×${Math.round(tela?.h ?? 0)})`);

    const estado = await page.getAttribute('[data-prova="cena-de-vidro"]', "data-estado");
    ok(estado === "ativa", `a cena reporta estado "${estado}"`);

    const antes = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    await page.waitForTimeout(700);
    const depois = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    ok(depois > antes, `o laço da cena está rodando (${antes} → ${depois} quadros)`);
    await page.screenshot({ path: `${EVIDENCIA}/acesso-cena.png` });
  }
  await ctx.close();

  // (b) `reduce`: a cena NÃO é montada, e a página não agenda um rAF sequer.
  const ctxCalmo = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const calmo = await ctxCalmo.newPage();
  await calmo.addInitScript({ content: CONTADOR_DE_RAF });
  await calmo.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await calmo.waitForTimeout(3500); // além do teto do requestIdleCallback

  const canvasNoCalmo = await calmo.locator(".acesso-cena canvas").count();
  ok(canvasNoCalmo === 0, `sob reduce não há canvas (achei ${canvasNoCalmo})`);
  const rafs = await calmo.evaluate(() => (window as unknown as { __raf: number }).__raf);
  ok(rafs === 0, `sob reduce a página não agenda requestAnimationFrame (contou ${rafs})`);
  // E o formulário continua inteiro — "menos movimento" não é "menos produto".
  ok((await calmo.locator("#email").count()) === 1, "sob reduce o formulário continua lá");
  await ctxCalmo.close();

  // (c) Sem WebGL: a cena se declara ausente e o formulário não nota.
  const ctxSemGpu = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const semGpu = await ctxSemGpu.newPage();
  await semGpu.addInitScript({ content: SEM_WEBGL });
  await semGpu.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await semGpu.waitForTimeout(3500);

  const estadoSemGpu = await semGpu.getAttribute('[data-prova="cena-de-vidro"]', "data-estado");
  ok(
    estadoSemGpu === "sem-webgl" || estadoSemGpu === null,
    `sem WebGL a cena se declara ausente (estado "${estadoSemGpu}")`,
  );
  const fundo = await caixa(semGpu, '[data-prova="fundo-da-cena"]');
  ok((fundo?.w ?? 0) > 0, "sem WebGL o fundo CSS continua desenhado");
  await semGpu.fill("#email", "alguem@exemplo.com");
  ok((await semGpu.inputValue("#email")) === "alguem@exemplo.com", "sem WebGL o formulário funciona");
  await semGpu.screenshot({ path: `${EVIDENCIA}/acesso-sem-webgl.png` });
  await ctxSemGpu.close();
}

// ── Bloco 3 · o rótulo flutuante ────────────────────────────────────────────

async function rotuloFlutuante(navegador: Browser) {
  console.log("\n═══ rótulo flutuante ═══");
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript({ content: REMENDO_DO_ESBUILD });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  // Esperar a CASCATA de entrada acabar antes da primeira medição: os campos
  // entram com `animation-delay` de até 310ms, e medir no meio disso compara
  // uma caixa em movimento com outra parada.
  await page.waitForTimeout(700);
  const vazio = await caixa(page, 'label[for="password"]');

  await page.fill("#password", "uma-senha-qualquer");
  // Espera o ESTADO, não o relógio. Um `waitForTimeout` fixo depende de a
  // máquina não estar ocupada — e aqui ela está, porque a cena WebGL da mesma
  // página disputa CPU. A primeira versão desta sonda dormia 400ms e leu o
  // rótulo parado, reprovando uma tela que estava certa.
  //
  // ⚠️ O timeout é CAPTURADO, não deixado estourar. Uma sonda que morre com
  // `TimeoutError` na metade não reporta os blocos seguintes e esconde tudo o
  // que viria depois — foi o que aconteceu quando a cena ficou pesada demais e
  // a página parou de rodar transições. Falha tem que virar linha de relatório.
  let subiu = true;
  try {
    await page.waitForFunction(
      () => {
        const l = document.querySelector('label[for="password"]');
        return !!l && getComputedStyle(l).transform !== "none";
      },
      undefined,
      { timeout: 5_000 },
    );
  } catch {
    subiu = false;
  }
  ok(subiu, "o rótulo flutuou dentro de 5s (se não, a página está travada)");
  await page.waitForTimeout(300); // a transição é de 200ms; deixa terminar
  const cheio = await caixa(page, 'label[for="password"]');

  if (vazio && cheio) {
    ok(vazio.y - cheio.y > 4, `o rótulo sobe ${Math.round(vazio.y - cheio.y)}px ao ganhar conteúdo`);
    ok(cheio.h < vazio.h, `e encolhe (${vazio.h.toFixed(1)} → ${cheio.h.toFixed(1)}px)`);
  } else {
    ok(false, 'label[for="password"] não foi encontrado');
  }

  await page.getByRole("button", { name: /mostrar senha/i }).click();
  ok((await page.getAttribute("#password", "type")) === "text", "o olho revela a senha");

  // O ícone do campo gira em perspectiva ao receber foco. Medido pela matriz
  // resolvida, não pela classe: classe certa e transform aplicado são coisas
  // diferentes.
  // `#email` tem `autoFocus`, então ele pode JÁ estar focado ao chegar aqui.
  // Tirar o foco primeiro é o que torna a comparação honesta — senão o "antes"
  // e o "depois" são o mesmo estado e a asserção passa sem provar nada.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(350);
  const lerIcone = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector("#email ~ .acesso-icone")!).transform,
    );

  const semFoco = await lerIcone();
  await page.focus("#email");
  // Espera o ESTADO mudar, com teto — e não um relógio. A cena WebGL da mesma
  // página disputa CPU, e um `waitForTimeout` fixo lê o valor de repouso numa
  // máquina ocupada, reprovando uma tela que está certa. Foi o que aconteceu na
  // primeira rodada desta sonda.
  let reagiu = true;
  try {
    await page.waitForFunction(
      (anterior) => {
        const el = document.querySelector("#email ~ .acesso-icone");
        return !!el && getComputedStyle(el).transform !== anterior;
      },
      semFoco,
      { timeout: 5_000 },
    );
  } catch {
    reagiu = false;
  }
  const comFoco = await lerIcone();
  ok(reagiu && semFoco !== comFoco, `o ícone reage ao foco (${semFoco} → ${comFoco})`);

  await ctx.close();
}

// ── Bloco 4 · o cadastro ────────────────────────────────────────────────────

async function cadastro(navegador: Browser) {
  console.log("\n═══ /signup ═══");
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript({ content: REMENDO_DO_ESBUILD });
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });

  const campos = await page.locator("form input").count();
  ok(campos === 4, `o formulário tem ${campos} campos (esperados 4)`);

  ok((await page.locator(".acesso-forca").count()) === 0, "sem senha digitada, não há medidor");
  await page.fill("#password", "uma-senha-qualquer");
  await page.waitForTimeout(300);
  ok((await page.locator(".acesso-forca").count()) === 1, "digitar a senha faz o medidor aparecer");
  const largura = await page.evaluate(
    () =>
      document.querySelector<HTMLElement>(".acesso-forca > span")?.getBoundingClientRect().width ?? 0,
  );
  ok(largura > 0, `a barra do medidor tem ${Math.round(largura)}px`);

  await page.screenshot({ path: `${EVIDENCIA}/acesso-signup.png`, fullPage: true });
  await ctx.close();
}

async function main() {
  mkdirSync(EVIDENCIA, { recursive: true });
  const navegador = await chromium.launch();
  try {
    await geometria(navegador);
    await cena(navegador);
    await rotuloFlutuante(navegador);
    await cadastro(navegador);
  } finally {
    await navegador.close();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`REPROVOU em ${falhas.length}:`);
    for (const f of falhas) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`PASSOU. Evidência em ${EVIDENCIA}/acesso-*.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
