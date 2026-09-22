"use client";

import * as React from "react";
import dynamic from "next/dynamic";

/**
 * O que decide SE a cena 3D existe — e o fundo que fica quando ela não existe.
 *
 * ═══ Três motivos para a cena não entrar, e os três são legítimos ═══
 *
 *  1. **`prefers-reduced-motion: reduce`.** Quem declarou isso no sistema
 *     operacional não recebe laço de animação nenhum. Não é "animar menos": o
 *     componente não é montado, o `three` não é nem baixado.
 *  2. **Sem WebGL** (VM, política de TI, driver bloqueado, GPU ausente). Quem
 *     detecta é a própria `CenaDeVidro`, no `try/catch` da criação do contexto.
 *  3. **Ainda não deu tempo.** O `three` só é buscado depois que o navegador
 *     fica ocioso. O formulário é o que a pessoa veio fazer, e ele não espera
 *     por decoração.
 *
 * ⚠️ O ponto 1 não é gosto — é contrato medido. `tests/sonda-telas-de-acesso.ts`
 * instala um contador de `requestAnimationFrame` ANTES do carregamento e afirma
 * que ele fica em **zero** sob `reduce`. Um laço de render do three.js reprova
 * ali automaticamente, e reprova com razão: a doutrina de movimento
 * (`docs/design-system/07-motion-language.md`) exige que movimento contínuo PARE
 * de verdade, não que fique imperceptível.
 *
 * ═══ O gradiente não é "o fallback" ═══
 *
 * `.acesso-fundo-css` é desenhado SEMPRE, numa camada abaixo da cena. Ele é o
 * fundo da tela nos três casos acima e continua atrás do vidro quando a cena
 * está viva. Tratá-lo como plano B faria a tela piscar de um fundo para outro
 * no instante em que o `three` chegasse.
 */

const CenaDeVidro = dynamic(() => import("./CenaDeVidro").then((m) => m.CenaDeVidro), {
  // O `three` toca `window` no import. Com SSR ligado, isto derrubaria a única
  // tela por onde se entra — e derrubaria no servidor, antes de qualquer pixel.
  ssr: false,
});

/** `requestIdleCallback` não existe no Safari < 17; o teto de 600ms o cobre. */
function quandoOcioso(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 600);
  return () => window.clearTimeout(id);
}

export function CascaDaCena() {
  const [ativa, setAtiva] = React.useState(false);

  React.useEffect(() => {
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelarOcioso: (() => void) | null = null;

    const reavaliar = () => {
      if (consulta.matches) {
        cancelarOcioso?.();
        cancelarOcioso = null;
        setAtiva(false);
        return;
      }
      if (cancelarOcioso) return;
      cancelarOcioso = quandoOcioso(() => setAtiva(true));
    };

    reavaliar();
    // Alguém pode ligar a preferência com a tela aberta. Reagir é barato e
    // evita que a única forma de desligar a cena seja recarregar a página.
    consulta.addEventListener("change", reavaliar);
    return () => {
      consulta.removeEventListener("change", reavaliar);
      cancelarOcioso?.();
    };
  }, []);

  return (
    <>
      <div aria-hidden data-prova="fundo-da-cena" className="acesso-fundo-css" />
      {ativa && <CenaDeVidro />}
    </>
  );
}
