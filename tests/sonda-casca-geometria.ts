/**
 * Sonda da MOLDURA EM L — mede as caixas, não olha a tela.
 *
 * ═══ Por que esta sonda existe ═══
 *
 * `tests/unit/barra-lateral-nao-flutua.test.ts` diz de si mesmo que lê CLASSES.
 * Classe certa e caixa certa são coisas diferentes: uma sobreposição de 1px
 * entre a barra e o painel, um canto que não arredonda, um preto que não é o
 * mesmo dos dois lados — nada disso aparece num teste que compara strings.
 *
 * ═══ Por que ela monta a casca À MÃO dentro de `/login` ═══
 *
 * A casca de verdade mora em `/app/*`, atrás de login, organização e banco —
 * inalcançável sem Supabase. E `/design` também exige sessão (`PUBLIC_PATHS`
 * não o inclui, e ACRESCENTÁ-LO só para tirar medida exporia o showcase interno
 * em toda instalação, o que é caro demais pelo preço de um screenshot).
 *
 * `/login` é público e carrega a MESMA folha de estilo compilada que o produto
 * inteiro usa. Montar a casca ali dentro dá o que importa: a cascata real, os
 * tokens reais, o `.casca-escura` real — sem rota nova e sem infraestrutura.
 *
 * ⚠️ O QUE ISTO NÃO PROVA. A marcação aqui é uma CÓPIA das classes de
 * `AppShell`, `AppSidebar` e `AppHeader`. Se aqueles arquivos mudarem de classe
 * e esta sonda não acompanhar, ela segue verde medindo uma casca que o produto
 * não tem mais. A prova da casca autenticada é o job `e2e` do CI, que sobe
 * Supabase e abre o produto de verdade.
 *
 * ⚠️ Medidas por `getBoundingClientRect()` e `getComputedStyle()`, NUNCA a olho
 * nem por comparação de imagem. Os screenshots são anexo para quem for ler
 * depois; a prova são os números.
 *
 * Run:  pnpm build && PORT=3100 pnpm start &
 *       E2E_PORT=3100 npx tsx tests/sonda-casca-geometria.ts
 */
import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

const PORTA = process.env.E2E_PORT ?? "3100";
const BASE = `http://127.0.0.1:${PORTA}`;
const EVIDENCIA = ".superpowers/evidence";

/** A altura do cabeçalho é CONTRATO: `InboxLayout` e `FlowBuilder` subtraem 56. */
const ALTURA_DO_CABECALHO = 56;
/** `--casca-raio` no globals.css. */
const RAIO = 18;

/**
 * As classes REAIS, copiadas de `app/app/_components/AppShell.tsx`,
 * `components/shell/sidebar/AppSidebar.tsx` e
 * `components/shell/header/AppHeader.tsx`.
 */
const CASCA = `
<div class="casca-moldura flex h-dvh w-full overflow-hidden" data-prova="moldura">
  <div class="hidden md:block">
    <aside data-prova="barra" data-collapsed="false"
           class="app-sidebar casca-escura sticky top-0 z-30 flex h-screen shrink-0 flex-col">
      <div class="nav-marca flex h-14 shrink-0 items-center gap-2.5 px-4">
        <img src="/gestalt-crm-branco.png" alt="Gestalt CRM" data-prova="logo"
             class="nav-logo h-6 w-auto object-contain">
        <span aria-hidden data-prova="simbolo" class="nav-marca-simbolo">G</span>
      </div>
      <nav class="nav-rolagem flex-1 space-y-1 overflow-y-auto p-2">
        <div class="nav-item flex h-10 items-center rounded-[10px] px-3 text-sm text-text-muted"><span class="nav-rotulo">Início</span></div>
        <div class="nav-item flex h-10 items-center rounded-[10px] px-3 text-sm text-text-muted"><span class="nav-rotulo">Inbox</span></div>
        <div class="nav-item flex h-10 items-center rounded-[10px] px-3 text-sm text-text-muted"><span class="nav-rotulo">Funil</span></div>
        <div class="nav-item flex h-10 items-center rounded-[10px] px-3 text-sm text-text-muted"><span class="nav-rotulo">Fluxos</span></div>
        <div class="nav-item flex h-10 items-center rounded-[10px] px-3 text-sm text-text-muted"><span class="nav-rotulo">Agenda</span></div>
      </nav>
    </aside>
  </div>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <header data-prova="cabecalho"
            class="app-header casca-escura sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 px-3 md:gap-4 md:px-6">
      <span class="text-sm font-medium text-text">Início</span>
    </header>
    <main data-prova="painel"
          class="min-h-0 flex-1 overflow-auto bg-surface md:rounded-tl-[var(--casca-raio)] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div class="mx-auto w-full max-w-[1600px] space-y-4">
        <h1 class="text-2xl font-bold text-text">Painel encaixado</h1>
        <p class="text-text-muted">Conteúdo de mentira — o que importa aqui são as caixas.</p>
        <div class="rounded-[14px] border bg-card p-4 shadow-sm" data-prova="cartao">
          <p class="text-sm text-text">Um cartão, para ver se ele se separa do painel branco.</p>
        </div>
        <button type="button" data-prova="botao"
                class="rounded-[10px] bg-accent px-4 py-2 text-sm font-medium text-accent-fg">Ação primária</button>
      </div>
    </main>
  </div>
</div>`;

const falhas: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ok    " : "  FALHA "}${msg}`);
  if (!cond) falhas.push(msg);
};

async function main() {
  mkdirSync(EVIDENCIA, { recursive: true });
  const navegador = await chromium.launch();

  for (const largura of [1440, 1024, 768, 390]) {
    const ctx = await navegador.newContext({ viewport: { width: largura, height: 900 } });
    const page = await ctx.newPage();
    const resposta = await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    if (!resposta?.ok()) throw new Error(`/login respondeu ${resposta?.status()}`);

    await page.evaluate((html) => {
      document.body.innerHTML = html;
      document.body.style.margin = "0";
    }, CASCA);
    // A imagem precisa ter carregado antes de medirmos a caixa dela.
    await page.waitForFunction(() => {
      const i = document.querySelector<HTMLImageElement>('[data-prova="logo"]');
      return !!i && i.complete;
    });

    console.log(`\n═══ ${largura}px ═══`);

    const m = await page.evaluate(() => {
      const caixa = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const estilo = (sel: string, prop: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).getPropertyValue(prop) : null;
      };
      return {
        barra: caixa('[data-prova="barra"]'),
        cabecalho: caixa('[data-prova="cabecalho"]'),
        painel: caixa('[data-prova="painel"]'),
        logo: caixa('[data-prova="logo"]'),
        simbolo: caixa('[data-prova="simbolo"]'),
        displayDoLogo: estilo('[data-prova="logo"]', "display"),
        displayDoSimbolo: estilo('[data-prova="simbolo"]', "display"),
        fundoDaBarra: estilo('[data-prova="barra"]', "background-color"),
        fundoDoCabecalho: estilo('[data-prova="cabecalho"]', "background-color"),
        fundoDaMoldura: estilo('[data-prova="moldura"]', "background-color"),
        fundoDoPainel: estilo('[data-prova="painel"]', "background-color"),
        fundoDoCartao: estilo('[data-prova="cartao"]', "background-color"),
        bordaDoCartao: estilo('[data-prova="cartao"]', "border-top-color"),
        textoDaBarra: estilo(".nav-item", "color"),
        raio: estilo('[data-prova="painel"]', "border-top-left-radius"),
        corDoBotao: estilo('[data-prova="botao"]', "background-color"),
        rolagemH: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    const { barra, cabecalho, painel, logo } = m;
    if (!cabecalho || !painel) throw new Error("cabeçalho ou painel não renderizaram");

    ok(
      Math.round(cabecalho.h) === ALTURA_DO_CABECALHO,
      `cabeçalho tem ${Math.round(cabecalho.h)}px (contrato: ${ALTURA_DO_CABECALHO})`,
    );
    ok(
      Math.round(painel.y) === Math.round(cabecalho.y + cabecalho.h),
      `painel começa onde o cabeçalho termina (y=${Math.round(painel.y)})`,
    );
    // A peça é CONTÍNUA: se os fundos divergirem, a junção vira uma emenda.
    ok(
      m.fundoDoCabecalho === m.fundoDaMoldura,
      `cabeçalho ${m.fundoDoCabecalho} = moldura ${m.fundoDaMoldura}`,
    );
    ok(
      m.fundoDoPainel === "rgb(255, 255, 255)",
      `painel é branco de verdade (${m.fundoDoPainel})`,
    );
    // As duas superfícies são brancas: quem separa o cartão é a borda.
    ok(
      m.fundoDoCartao !== m.bordaDoCartao,
      `cartão se separa do painel pela borda (${m.bordaDoCartao})`,
    );
    ok(!m.rolagemH, "não há rolagem horizontal");

    if (largura >= 768) {
      if (!barra) throw new Error(`a barra sumiu em ${largura}px, onde deveria existir`);
      ok(
        Math.round(painel.x) === Math.round(barra.x + barra.w),
        `painel encosta na barra sem sobrepor (x=${Math.round(painel.x)})`,
      );
      ok(
        m.fundoDaBarra === m.fundoDaMoldura,
        `barra ${m.fundoDaBarra} = moldura ${m.fundoDaMoldura}`,
      );
      ok(m.raio === `${RAIO}px`, `canto do painel = ${m.raio}`);
      /**
       * A MARCA EM DUAS FORMAS, e qual delas aparece é decidido SÓ por CSS.
       *
       * Entre 768 e 1023 a barra tem 72px e o cookie continua dizendo
       * "expandida" — o componente não sabe que está estreito. Antes, o `<img>`
       * era recortado com `object-fit: cover` e sobrava uma tira de ~6px; agora
       * ele some e entra o ladrilho da inicial. Esta é a única medida que
       * distingue as duas coisas, porque as duas "funcionam" no DOM.
       */
      const estreita = largura <= 1023;
      ok(
        (m.displayDoLogo === "none") === estreita,
        `em ${largura}px o wordmark está ${m.displayDoLogo} (estreita=${estreita})`,
      );
      ok(
        (m.displayDoSimbolo !== "none") === estreita,
        `em ${largura}px o ladrilho está ${m.displayDoSimbolo} (estreita=${estreita})`,
      );

      if (estreita && m.simbolo) {
        ok(
          Math.round(m.simbolo.w) === 32 && Math.round(m.simbolo.h) === 32,
          `ladrilho quadrado de ${Math.round(m.simbolo.w)}×${Math.round(m.simbolo.h)}px`,
        );
      }
      if (logo && !estreita) {
        ok(logo.h >= 20, `logo com ${Math.round(logo.h)}px de altura (era ~11px na arte crua)`);
        // ⚠️ O teto encolheu junto com a altura: o wordmark rendia ~223px numa
        // barra de 264 e era o elemento mais pesado da tela. Metade da barra é
        // o limite acima do qual ele volta a dominar a navegação.
        ok(
          logo.w <= barra.w / 2,
          `logo com ${Math.round(logo.w)}px ocupa menos que metade dos ${Math.round(barra.w)}px da barra`,
        );
      }
      console.log(`  ·     barra ${Math.round(barra.w)}px · texto da navegação ${m.textoDaBarra}`);
    } else {
      ok(barra === null, "abaixo de 768 a barra é escondida");
      ok(m.raio === "0px", `sem moldura à esquerda, o canto é reto (${m.raio})`);
    }

    console.log(`  ·     botão primário ${m.corDoBotao}`);
    await page.screenshot({ path: `${EVIDENCIA}/casca-${largura}.png` });
    await ctx.close();
  }

  await navegador.close();
  console.log("");
  if (falhas.length > 0) {
    console.log(`REPROVOU em ${falhas.length}:`);
    for (const f of falhas) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`PASSOU. Evidência em ${EVIDENCIA}/casca-*.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
