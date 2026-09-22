"use client";

import * as React from "react";
import {
  Clock,
  Color,
  EquirectangularReflectionMapping,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
  CanvasTexture,
  type BufferGeometry,
  type IUniform,
} from "three";

/**
 * A cena de vidro das telas de acesso — three.js cru, sem React Three Fiber.
 *
 * ═══ Por que three cru ═══
 *
 * A cena não tem estado de React, não tem filhos dinâmicos e não se beneficia
 * de reconciliação. R3F + drei custariam mais bytes que o `three` inteiro para
 * não mudar um pixel. A transmissão de verdade (`MeshPhysicalMaterial`) está no
 * core; `drei` não é necessário para nada do que se vê aqui.
 *
 * ═══ Zero asset, e isso é decisão de arquitetura ═══
 *
 * O ambiente que o vidro reflete é um `CanvasTexture` DESENHADO EM CÓDIGO e
 * passado pelo `PMREMGenerator`. A textura da superfície é ruído em GLSL,
 * injetado por `onBeforeCompile`. Nada disso é arquivo.
 *
 * Não é purismo: `.glb`, `.hdr` e `.ktx2` NÃO estão na allowlist de extensões do
 * `proxy.ts`, e asset com extensão de fora responde **307 para /login, em
 * silêncio, em toda instalação** — foi exatamente assim que o modelo 3D anterior
 * morreu (ver o comentário em `proxy.ts:136-142`). Textura calculada não tem
 * como cair nessa armadilha.
 *
 * ═══ A cor sai da marca, nunca do código ═══
 *
 * `--color-accent` é lido do documento com `getComputedStyle`. A instalação que
 * configurar outra cor recebe a cena naquela cor, pela mesma pilha que pinta o
 * resto do produto.
 *
 * ═══ O que é refratado ═══
 *
 * Vidro com `transmission` refrata o que está ATRÁS dele NA CENA — não o DOM.
 * Com um `renderer` transparente e nada atrás, o vidro ficaria oco e cinza. Por
 * isso a cena tem um fundo próprio (`scene.background`, o mesmo gradiente do
 * ambiente): é ele que aparece dentro do vidro.
 *
 * ═══ Guardas — herdadas do modelo 3D que foi apagado ═══
 *
 * O código morreu; as lições não. `try/catch` na criação do contexto,
 * `visibilitychange` parando o laço, `ResizeObserver` remedindo, DPR com teto de
 * 2, e `forceContextLoss()` ANTES de `dispose()` no cleanup — o navegador tem
 * teto de ~16 contextos WebGL por aba, e sem isso uma navegação repetida entre
 * `/login` e `/signup` esgota.
 *
 * ⚠️ Este componente NÃO é montado sob `prefers-reduced-motion: reduce`. Quem
 * decide é `CascaDaCena`, e a razão está lá: `tests/sonda-telas-de-acesso.ts`
 * afirma que a página não agenda UM `requestAnimationFrame` sequer nesse modo.
 */

/** Teto de DPR: acima de 2 o custo quadruplica e ninguém vê diferença. */
const DPR_MAXIMO = 2;
/** Quantos corpos de vidro. Cada um custa um passe de transmissão. */
const CORPOS = 5;

/** Lê um token de cor do documento. Vazio → o chamador decide o padrão. */
function corDoDocumento(token: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

/**
 * O ambiente: um equirretangular desenhado num `<canvas>` 2D.
 *
 * ⚠️ As FAIXAS não são enfeite, e a primeira versão desta cena não as tinha —
 * era um gradiente liso, e os corpos saíram parecendo massa verde opaca.
 *
 * O motivo é físico: vidro não se vê, vê-se o que ele ENTORTA. Com um fundo de
 * cor quase uniforme não há nada para entortar, então a refração devolve a mesma
 * cor e a superfície lê como plástico fosco. São as bordas de faixa — claro
 * contra escuro — que revelam a curvatura ao serem dobradas.
 *
 * As manchas radiais fazem o outro trabalho: são as "luzes" que produzem brilho
 * especular. Sem elas a peça fica sem ponto de luz e lê como fosca de novo.
 */
function texturaDeAmbiente(accent: string, comFaixas: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) return new CanvasTexture(c);

  const base = new Color(accent);
  const claro = base.clone().lerp(new Color("#ffffff"), comFaixas ? 0.8 : 0.5);
  const escuro = base.clone().lerp(new Color("#000000"), comFaixas ? 0.7 : 0.45);

  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, `#${claro.getHexString()}`);
  g.addColorStop(0.5, `#${base.getHexString()}`);
  g.addColorStop(1, `#${escuro.getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);

  if (comFaixas) {
    // Faixas diagonais de contraste — o "estúdio" que o vidro vai dobrar.
    ctx.save();
    ctx.translate(512, 256);
    ctx.rotate(-0.35);
    for (let i = -14; i <= 14; i += 1) {
      const claraNaVez = i % 2 === 0;
      ctx.fillStyle = claraNaVez ? "rgba(255,255,255,0.42)" : "rgba(0,0,0,0.30)";
      ctx.fillRect(-900, i * 46, 1800, claraNaVez ? 26 : 18);
    }
    ctx.restore();
  }

  for (const [x, y, r, alfa] of [
    [230, 130, 190, comFaixas ? 0.95 : 0.4],
    [760, 90, 130, comFaixas ? 0.75 : 0.3],
    [520, 420, 230, comFaixas ? 0.35 : 0.14],
  ] as const) {
    const brilho = ctx.createRadialGradient(x, y, 0, x, y, r);
    brilho.addColorStop(0, `rgba(255,255,255,${alfa})`);
    brilho.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = brilho;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new CanvasTexture(c);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * O ruído que faz a superfície ondular — é o "liquid" do liquid glass.
 *
 * Deslocamento no VÉRTICE, não normal map no fragmento. Com transmissão, a
 * normal é o que decide para onde a luz entorta: uma normal falsa de textura dá
 * relevo que não bate com a silhueta, e o olho percebe. Deslocar de verdade
 * ondula a borda junto, que é o que se espera de algo líquido.
 *
 * A normal é RECALCULADA por diferenças finitas em duas tangentes. Sem isso o
 * corpo ondula e continua sombreado como se fosse liso.
 */
const RUIDO_GLSL = /* glsl */ `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float ruido(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                       dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  float onda(vec3 p, float t) {
    return ruido(p * 1.5 + vec3(0.0, t * 0.25, 0.0)) * 0.6
         + ruido(p * 3.1 - vec3(t * 0.18, 0.0, 0.0)) * 0.3;
  }
`;

type Uniformes = { uTempo: IUniform<number>; uAmplitude: IUniform<number> };

/** Injeta o ruído no material padrão do three, sem reescrever o shader dele. */
function comSuperficieLiquida(material: MeshPhysicalMaterial): Uniformes {
  const uniformes: Uniformes = { uTempo: { value: 0 }, uAmplitude: { value: 0.09 } };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTempo = uniformes.uTempo;
    shader.uniforms.uAmplitude = uniformes.uAmplitude;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTempo;
         uniform float uAmplitude;
         ${RUIDO_GLSL}`,
      )
      // `begin_normal_vertex` define `objectNormal`; recalculamos ali, ANTES de
      // `defaultnormal_vertex` transformar a normal para o espaço da view.
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
         {
           vec3 t1 = normalize(abs(objectNormal.y) < 0.99
             ? cross(objectNormal, vec3(0.0, 1.0, 0.0))
             : cross(objectNormal, vec3(1.0, 0.0, 0.0)));
           vec3 t2 = normalize(cross(objectNormal, t1));
           float e = 0.06;
           vec3 pc = position + objectNormal * onda(position, uTempo) * uAmplitude;
           vec3 pa = position + t1 * e;
           pa += normalize(pa) * onda(pa, uTempo) * uAmplitude;
           vec3 pb = position + t2 * e;
           pb += normalize(pb) * onda(pb, uTempo) * uAmplitude;
           objectNormal = normalize(cross(pa - pc, pb - pc)) * sign(dot(objectNormal, normalize(cross(pa - pc, pb - pc))));
         }`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         transformed += objectNormal * onda(position, uTempo) * uAmplitude;`,
      );
  };
  // Materiais com `onBeforeCompile` diferente precisam de chave de cache
  // distinta, senão o three reusa o programa compilado do material anterior.
  material.customProgramCacheKey = () => "acesso-vidro-liquido";

  return uniformes;
}

type Corpo = {
  readonly malha: Mesh;
  readonly uniformes: Uniformes;
  readonly base: { x: number; y: number; z: number };
  readonly giro: { x: number; y: number };
  readonly fase: number;
};

export function CenaDeVidro() {
  const hospedeiro = React.useRef<HTMLDivElement>(null);
  const [falhou, setFalhou] = React.useState(false);

  React.useEffect(() => {
    const alvo = hospedeiro.current;
    if (!alvo) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      // Máquina sem GPU, VM, política de TI, driver bloqueado. O fundo CSS
      // fica, e o formulário nunca depende disto para funcionar.
      setFalhou(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_MAXIMO));
    // O passe de transmissão é o gargalo: ele redesenha a cena inteira para cada
    // corpo de vidro. Em meia resolução a diferença não se vê atrás de um vidro
    // que já borra, e o custo cai para um quarto.
    renderer.transmissionResolutionScale = 0.5;
    renderer.setSize(alvo.clientWidth, alvo.clientHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    alvo.appendChild(renderer.domElement);

    const accent = corDoDocumento("--color-accent") || "#13731b";
    const cena = new Scene();

    // ⚠️ DUAS texturas, e a separação é o conserto de um defeito que a prova em
    // tela mostrou: com uma só, as faixas de alto contraste — que existem para o
    // vidro ter o que entortar — viravam PAPEL DE PAREDE listrado atrás do
    // cartão. O lugar delas é dentro do vidro, não atrás dele.
    //
    //  · `ambiente` (com faixas) → só `scene.environment`: alimenta reflexo e
    //    refração, e é o que faz a peça ler como vidro.
    //  · `fundo` (gradiente calmo) → `scene.background`: acompanha o gradiente
    //    de `.acesso-fundo-css`, então a troca do fundo CSS pela cena não pisca.
    const ambiente = texturaDeAmbiente(accent, true);
    const fundo = texturaDeAmbiente(accent, false);
    const pmrem = new PMREMGenerator(renderer);
    const alvoDoAmbiente = pmrem.fromEquirectangular(ambiente);
    cena.environment = alvoDoAmbiente.texture;
    cena.background = fundo;

    const camera = new PerspectiveCamera(42, alvo.clientWidth / alvo.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 9);

    const tintaDoVidro = new Color(accent).lerp(new Color("#ffffff"), 0.55);
    const corpos: Corpo[] = [];

    for (let i = 0; i < CORPOS; i += 1) {
      const anel = i % 3 === 2;
      const raio = 0.5 + (i % 4) * 0.18;
      const geometria: BufferGeometry = anel
        ? new TorusGeometry(raio, raio * 0.36, 48, 128)
        : new IcosahedronGeometry(raio, 24);

      const material = new MeshPhysicalMaterial({
        color: tintaDoVidro,
        metalness: 0,
        // Rugosidade baixa: vidro fosco não refrata, difunde — e difusão é
        // exatamente o que fazia a primeira versão parecer massa.
        roughness: 0.02 + (i % 3) * 0.02,
        transmission: 1,
        // Espessura alta exagera o desvio da luz. É o que torna a refração
        // VISÍVEL numa peça pequena na tela.
        thickness: raio * 3.2,
        ior: 1.52,
        // Dispersão cromática: separa o branco em cor nas bordas, como vidro de
        // verdade. É o detalhe que o olho reconhece sem saber nomear.
        //
        // ⚠️ MEDIDO: dispersão faz o three renderizar o passe de transmissão UMA
        // VEZ POR CANAL. Com 2.4 e sete corpos a página caiu a poucos quadros por
        // segundo e até a transição do rótulo do formulário parou de rodar — a
        // sonda reprovou por timeout, não por desenho errado. Números altos aqui
        // são bonitos numa captura e inutilizáveis numa máquina real.
        dispersion: 0.6,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        iridescence: 0.35,
        iridescenceIOR: 1.35,
        envMapIntensity: 1.4,
      });
      const uniformes = comSuperficieLiquida(material);

      const malha = new Mesh(geometria, material);
      // Distribuição em anel largo, aberta no meio: o cartão de vidro mora lá,
      // e corpo atrás de texto é exatamente o que o piso de contraste do cartão
      // não deveria precisar segurar sozinho.
      const angulo = (i / CORPOS) * Math.PI * 2 + 0.4;
      const base = {
        x: Math.cos(angulo) * (4.3 + (i % 2) * 0.6),
        y: Math.sin(angulo) * (2.3 + (i % 3) * 0.4),
        z: -1.2 + (i % 4) * 0.55,
      };
      malha.position.set(base.x, base.y, base.z);
      malha.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

      cena.add(malha);
      corpos.push({
        malha,
        uniformes,
        base,
        giro: { x: 0.05 + (i % 3) * 0.035, y: 0.07 + (i % 4) * 0.03 },
        fase: i * 1.37,
      });
    }

    // ── Interação ────────────────────────────────────────────────────────────
    // O ponteiro move um ALVO; o quadro persegue esse alvo com amortecimento.
    // Seguir 1:1 faz a cena tremer junto com a mão e cansa em segundos.
    const ponteiro = new Vector2(0, 0);
    const suave = new Vector2(0, 0);
    /** 0 = repouso · 1 = alguém está preenchendo o formulário. */
    let foco = 0;
    let focoAlvo = 0;
    /** Pulso do envio, decai sozinho. */
    let pulso = 0;

    const aoMover = (e: PointerEvent) => {
      ponteiro.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    };
    const aoEntrarNoCampo = (e: FocusEvent) => {
      const alvoDoEvento = e.target as HTMLElement | null;
      if (alvoDoEvento?.matches("input, button, a")) focoAlvo = 1;
    };
    const aoSairDoCampo = () => {
      focoAlvo = 0;
    };
    const aoEnviar = () => {
      pulso = 1;
    };

    window.addEventListener("pointermove", aoMover, { passive: true });
    document.addEventListener("focusin", aoEntrarNoCampo);
    document.addEventListener("focusout", aoSairDoCampo);
    document.addEventListener("submit", aoEnviar, true);

    // ── O laço ───────────────────────────────────────────────────────────────
    const relogio = new Clock();
    let pedido = 0;
    let rodando = true;

    const quadro = () => {
      pedido = requestAnimationFrame(quadro);
      const t = relogio.getElapsedTime();
      const dt = Math.min(relogio.getDelta(), 0.05);

      suave.lerp(ponteiro, 1 - Math.pow(0.001, dt));
      foco = MathUtils.lerp(foco, focoAlvo, 1 - Math.pow(0.02, dt));
      pulso = Math.max(0, pulso - dt * 1.6);

      for (const corpo of corpos) {
        corpo.uniformes.uTempo.value = t + corpo.fase;
        // Quem está preenchendo o formulário recebe uma cena mais calma: a
        // ondulação cai. Movimento que compete com leitura é ruído.
        corpo.uniformes.uAmplitude.value = 0.09 - foco * 0.04 + pulso * 0.07;

        corpo.malha.rotation.x += corpo.giro.x * dt;
        corpo.malha.rotation.y += corpo.giro.y * dt;

        // Com foco no formulário os corpos se afastam do centro; no pulso,
        // avançam. É o retorno de interação pedindo licença, não fogos.
        const empurrao = 1 + foco * 0.16 - pulso * 0.1;
        const flutuacao = Math.sin(t * 0.5 + corpo.fase) * 0.22;
        corpo.malha.position.set(
          corpo.base.x * empurrao + suave.x * 0.55,
          corpo.base.y * empurrao + flutuacao - suave.y * 0.4,
          corpo.base.z,
        );
      }

      camera.position.x = suave.x * 0.35;
      camera.position.y = -suave.y * 0.25;
      camera.lookAt(0, 0, 0);
      renderer.render(cena, camera);
    };

    const retomar = () => {
      if (rodando || document.hidden) return;
      rodando = true;
      relogio.start();
      pedido = requestAnimationFrame(quadro);
    };
    const pausar = () => {
      if (!rodando) return;
      rodando = false;
      cancelAnimationFrame(pedido);
      relogio.stop();
    };
    const aoTrocarDeAba = () => (document.hidden ? pausar() : retomar());
    document.addEventListener("visibilitychange", aoTrocarDeAba);

    const medidor = new ResizeObserver(() => {
      const l = alvo.clientWidth;
      const a = alvo.clientHeight;
      if (l === 0 || a === 0) return;
      camera.aspect = l / a;
      camera.updateProjectionMatrix();
      renderer.setSize(l, a);
    });
    medidor.observe(alvo);

    pedido = requestAnimationFrame(quadro);

    return () => {
      cancelAnimationFrame(pedido);
      medidor.disconnect();
      window.removeEventListener("pointermove", aoMover);
      document.removeEventListener("focusin", aoEntrarNoCampo);
      document.removeEventListener("focusout", aoSairDoCampo);
      document.removeEventListener("submit", aoEnviar, true);
      document.removeEventListener("visibilitychange", aoTrocarDeAba);

      for (const corpo of corpos) {
        corpo.malha.geometry.dispose();
        (corpo.malha.material as MeshPhysicalMaterial).dispose();
      }
      alvoDoAmbiente.dispose();
      pmrem.dispose();
      ambiente.dispose();
      fundo.dispose();
      // Nesta ordem: liberar o contexto ANTES de descartar o renderer. O
      // navegador guarda ~16 contextos WebGL por aba e não os recicla sozinho;
      // sem isto, ir e voltar entre /login e /signup esgota o teto e a cena
      // deixa de aparecer sem erro nenhum no console.
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Em falha o hospedeiro fica vazio de propósito: o gradiente de
  // `.acesso-fundo-css` está numa camada abaixo e continua desenhado.
  return (
    <div
      ref={hospedeiro}
      aria-hidden
      data-prova="cena-de-vidro"
      data-estado={falhou ? "sem-webgl" : "ativa"}
      className="acesso-cena"
    />
  );
}
