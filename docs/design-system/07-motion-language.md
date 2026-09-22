# 07 — Motion Language

> **Source of truth:** `app/design/lib/tokens.ts` → `MOTION`, `app/design/showcase.css` (keyframes `ds-*`)

## Filosofia

Motion no DeskcommCRM **comunica continuidade espacial** — a interface não "aparece", ela "se desloca" da posição anterior pra atual. Não é decoração, não é celebração, não é "modernidade". Cada animação tem propósito; o que não tem, sai.

Quatro testes pra cada animação:

1. **Posso explicar o que essa animação comunica em uma frase?** Se a resposta é "fica bonito", remove.
2. **A duração é proporcional à distância visual?** 8px de translate → 200ms; 100% de slide → 320ms+.
3. **A curva combina com o tipo de movimento?** Entrada suave (`ease-out` sharp), saída firme (`ease-in`), playfulness pontual (`spring`).
4. **Funciona com `prefers-reduced-motion: reduce`?** Sim ou cai pra fade simples.

## 4 tipos canônicos

### 1. Page transition

Quando navegação muda a view inteira (`/inbox` → `/kanban`).

```css
@keyframes ds-page-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page { animation: ds-page-enter 320ms cubic-bezier(0.16, 1, 0.3, 1); }
```

Curva: `cubic-bezier(0.16, 1, 0.3, 1)` (`motion-slow`). 320ms. Sempre fade + 8px rise (nunca só fade).

### 2. Component enter/exit (modal/sheet)

Modal: scale 0.985 → 1 + translateY(8px) → 0 + fade. 320ms ease-spring.
Sheet: translateX(100%) → 0 + fade backdrop. 320ms ease-spring.

```css
@keyframes ds-modal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

Backdrop entra com fade 200ms ease-base **antes** do conteúdo (5–10ms de offset).

### 3. Hover state

Cards interativos: `translateY(-1px)` + `border-color: accent` + `shadow-sm`. 150–200ms `ease-out`.

```css
.card-interactive {
  transition:
    border-color 120ms cubic-bezier(0.2, 0, 0, 1),
    transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.card-interactive:hover { transform: translateY(-1px); }
```

Botões: `transform: translateY(1px)` no `:active` (pressed feel), 80ms (instantâneo).

### 4. Skeleton shimmer

Loader visual: linear-gradient atravessa o elemento da direita pra esquerda, infinito.

```css
.skeleton {
  background: linear-gradient(90deg,
    var(--ds-surface-elevated) 0%,
    color-mix(in srgb, var(--ds-surface-elevated) 60%, var(--ds-accent-soft)) 50%,
    var(--ds-surface-elevated) 100%);
  background-size: 200% 100%;
  animation: ds-shimmer 1.6s linear infinite;
}
@keyframes ds-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Duração 1.6s (não 1s — fica frenético; não 2s — fica lento).

### 5. Rótulo flutuante (campo de formulário)

O rótulo começa dentro do campo e sobe quando ele ganha foco **ou** conteúdo.
Comunica uma coisa, e cabe numa frase: *o campo saiu de vazio para preenchido*.

```css
.acesso-campo > input:focus ~ label,
.acesso-campo > input:not(:placeholder-shown) ~ label {
  transform: translateY(-0.82rem) scale(0.76);
}
```

Duas propriedades, não mais: `transform` (translate + scale ainda são UMA) e
`color`. 200ms `ease-out`.

**Depende de `placeholder=" "` no input** — um espaço, não vazio. É o que faz
`:placeholder-shown` significar "sem conteúdo" sem um byte de JavaScript. Sem
ele o rótulo nunca sobe e fica por cima do texto digitado.

⚠️ **Campo com `autoFocus` já nasce com o rótulo levantado**, porque `:focus`
casa antes de qualquer digitação. Está certo — mas uma medição que compare
"antes e depois de preencher" num campo autofocado lê o estado flutuado nas duas
pontas e reprova o comportamento correto. Meça num campo que não recebe foco
automático (custou uma rodada de sonda das telas de acesso).

### 6. Medidor que acompanha a digitação

Barra que cresce enquanto se digita (força da senha). Anima só `width`, 200ms.

⚠️ **Ele DESCREVE, não decide.** A regra que barra o envio vive no schema Zod;
um medidor que prometesse mais do que o servidor exige inventaria uma política
que nenhuma camada aplica. E vai `aria-hidden`: quem usa leitor de tela já
recebe a mensagem de erro do campo, e narrar "força 2 de 4" a cada tecla é ruído
sobre a informação boa.

---

## Curvas canônicas

| Token | cubic-bezier | Onde usar |
|-------|--------------|-----------|
| `ease-out-fast` | `(0.2, 0, 0, 1)` | Hover, micro-feedback (cor, border) |
| `ease-base` | `(0.25, 0.1, 0.25, 1)` | Default UI (fade, color shift) |
| `ease-out-slow` | `(0.16, 1, 0.3, 1)` | Page enter, modal, sheet |
| `ease-spring` | `(0.34, 1.56, 0.64, 1)` | Pop, drag confirm, badge celebration |

## Durations

| Token | Valor | Quando |
|-------|-------|--------|
| `motion-fast` | 120ms | Hover state, color, border |
| `motion-base` | 200ms | Fade simples, color shift composto |
| `motion-slow` | 320ms | Page transition, modal, sheet |
| `motion-spring` | 420ms | Spring pop (raro) |

**Regra:** durações fora dessa tabela são proibidas. Se precisa de 250ms, use 200; de 280, use 320.

---

## Princípios

- **Nunca animar mais de 2 propriedades simultâneas** (excetuando shadow + border, que andam junto). Mais que isso vira ruído.
- **Sempre incluir transform companheiro do fade.** Fade puro (`opacity 0 → 1`) parece flicker; fade + translate(Y/X) parece movimento.
- **Curva combina com origem.** Hover (de fora pra dentro) usa `ease-out`; click (de dentro pra fora) usa `ease-in` — mas raramente animamos saída de click.
- **Stagger é especial.** Lista que entra com cada item atrasado em 50ms é aceitável **uma vez por sessão** (primeiro carregamento). Após scroll/refetch, sem stagger.

---

## `prefers-reduced-motion`

Sempre respeitar. Em vez de remover toda animação, **simplificar pra fade-only com duração reduzida**:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Skeleton shimmer pode manter (não causa motion sickness).

**Simplificar não é apagar.** No rótulo flutuante, suprimir o `transform` sob
`reduce` deixaria o rótulo por cima do texto digitado — trocaria enjoo por um
campo ilegível. O que sai é o PERCURSO (`transition: none`), não a posição final.
A pergunta certa é "o que esta animação informa, e como entrego isso parado?".

**Movimento contínuo precisa PARAR de verdade, não só ficar imperceptível.** Uma
rotação 3D sob `reduce` desenha um quadro e encerra o `requestAnimationFrame` —
`animation-duration: 0.01ms` do bloco acima não alcança laço em JavaScript, e um
canvas girando numa aba de fundo queima bateria sem que ninguém veja um quadro.
Vale o mesmo para aba escondida (`visibilitychange`) e elemento fora do viewport
(`IntersectionObserver`).

---

## Movimento ambiente

Categoria à parte, criada quando as telas de acesso ganharam fundo animado —
primeiro ondas em SVG, hoje uma cena de vidro em WebGL. **Ela não flexibiliza nada do que está acima** — existe porque
aquilo é outra coisa, e tratar as duas pela mesma régua fazia a tabela de
durações proibir o que ela nunca teve a intenção de governar.

A diferença é de natureza: **UI responde, ambiente não.** Uma transição de 200ms
é a resposta da interface a alguma coisa que aconteceu — um clique, um foco, uma
rota. Movimento ambiente não responde a nada e não informa nada; é textura. Um
laço de 30 segundos que respondesse a um clique seria uma interface quebrada, e
uma textura de 200ms seria um piscar.

Para uma animação entrar nesta categoria, as seis linhas valem juntas:

1. **É `aria-hidden` e não carrega informação.** Remover o movimento não tira
   nada de ninguém — a tela continua dizendo a mesma coisa parada.
2. **Não responde a nada.** Nem a ação, nem a estado, nem a carregamento. Não
   entra em botão, campo, lista, modal nem indicador de progresso.
3. **Uma propriedade animada por camada, e ela é `transform`.** Vale a mesma
   razão de sempre: `transform` compõe fora do layout.
4. **Período ≥ 8 segundos.** É o que garante que ninguém leia aquilo como
   resposta da interface. Abaixo disso, é UI e volta para a tabela de cima.
5. **Sob `prefers-reduced-motion: reduce`, para inteiro.** Aqui não se aplica o
   "simplificar, não apagar": movimento contínuo não tem posição final a
   preservar, e a seção acima já exige que ele pare de verdade.
6. **Só em superfície decorativa declarada.** Se você precisa argumentar que o
   elemento é decorativo, ele não é.

**Onde isto vive hoje:** a cena de vidro das telas de acesso
(`components/auth/CenaDeVidro.tsx`), montada por `CascaDaCena`. Caso novo não
entra por semelhança — responde às seis linhas ou vira UI.

### ⚠️ Quando o movimento é WebGL, `animation: none` NÃO desliga nada

CSS não alcança laço em JavaScript. Um `@media (prefers-reduced-motion: reduce)`
com `animation: none` não toca um `requestAnimationFrame`, e a cena continuaria
girando para quem pediu para ela parar.

**A regra 5, em canvas, é montagem: o componente não é montado.** `CascaDaCena`
consulta `matchMedia("(prefers-reduced-motion: reduce)")` em JavaScript e, se a
preferência estiver ligada, nem faz o import dinâmico do `three`. Não é "menos
quadros" — é zero.

Quem vigia é `tests/sonda-telas-de-acesso.ts`: ele instala um contador de
`requestAnimationFrame` **antes** do primeiro quadro da página e afirma que ele
fica em **zero** sob `reduce`. Qualquer laço que escape reprova ali, inclusive um
que alguém ache que "é leve".

O mesmo vale para os outros dois desligamentos que a seção acima exige: aba
escondida (`visibilitychange`) e elemento fora do viewport
(`IntersectionObserver`) precisam **cancelar o `rAF`**, não baixar a taxa.

---

## Anti-patterns

❌ **Spring com bounce alto.** `cubic-bezier(0.68, -0.55, 0.27, 1.55)` ou similar. Faz o elemento "pular". Reservar bounce sutil (`1.56`) pra raros casos.

❌ **Parallax decorativo.** Hero scroll com 3 layers se movendo em velocidades diferentes. Não combina com soft-tech.

> ⚠️ O que este item proíbe é o vínculo com o SCROLL — a página que se desmonta
> em camadas enquanto se rola. A cena de vidro das telas de acesso reage ao
> PONTEIRO e ao foco de campo, e **não** é este caso: ela não lê posição de
> scroll, e o deslocamento é amortecido, nunca 1:1 com a mão. Responde às seis
> linhas de **Movimento ambiente** acima. Se alguém ligar camada decorativa a
> scroll, volta a cair aqui.

❌ **Fade-in sem transform companheiro.** Vira flicker em monitor de baixa taxa.

❌ **Animação em scroll de lista.** Scroll é fluido por natureza; adicionar animação a items que entram no viewport custa CPU e gera ruído visual.

❌ **Loading com mais de 1 elemento animado.** Spinner + skeleton + texto pulsando = caos. Escolha **um**: skeleton, ou spinner, ou texto.

❌ **Transition em `all`.** `transition: all 200ms` pega `width`, `height`, propriedades caras. Sempre liste o que muda: `transition: background 120ms, border-color 120ms`.

❌ **Duração > 500ms em UI funcional.** Modal entrando em 600ms parece travado. Spring/celebration pode ir até 600ms; UI normal nunca.
