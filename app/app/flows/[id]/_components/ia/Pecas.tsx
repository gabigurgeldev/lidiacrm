"use client";

/**
 * As peças de tela do painel "Criar fluxo com IA".
 *
 * A versão anterior era `<p>` cru com botões `outline` soltos: sem hierarquia,
 * sem estado de espera decente ("Pensando…" em texto), sem transição nenhuma.
 * Funcionava e parecia inacabado — e este painel é a primeira vez que alguém vê
 * a IA do produto trabalhando.
 *
 * ═══ Sem dependência nova ═══
 *
 * ⚠️ ESTE PARÁGRAFO DIZIA que a animação era `tailwindcss-animate`
 * (`animate-in`, `fade-in`, `zoom-in-95`). O plugin NÃO está instalado
 * (`plugins: []` em `tailwind.config.ts`): as classes não existiam e nenhuma
 * das animações acontecia. O painel que este arquivo descreve como "a primeira
 * vez que alguém vê a IA do produto trabalhando" era estático.
 *
 * Hoje a animação é CSS à mão (`.ia-surge`, `.ia-aparece`, em
 * `app/globals.css`), no mesmo padrão de `.barra-indeterminada`. `framer-motion`
 * continua fora, e agora `tailwindcss-animate` também: peso de runtime novo
 * para um painel é o tipo de custo que um self-hoster paga em disco e memória
 * sem nunca ter pedido.
 */
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Info, PaperPlaneTilt, SkipForward, Sparkle, Warning } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─────────────────────────────── trilho de passos ────────────────────────────

export type PassoDoTrilho = "descrever" | "esclarecer" | "planejar" | "montar";

const ORDEM: PassoDoTrilho[] = ["descrever", "esclarecer", "planejar", "montar"];

/**
 * O trilho de progresso.
 *
 * Reusa a LINGUAGEM VISUAL do `app/onboarding/_components/Stepper.tsx` (bolinha
 * numerada, preenchida no passo atual, marcada nos cumpridos) sem reusar o
 * componente: aquele deriva o passo de `usePathname()`, e aqui não há uma rota
 * por passo — o painel inteiro vive numa tela só, de propósito.
 */
export function PassosDaGeracao({
  atual,
  rotulos,
}: {
  atual: PassoDoTrilho;
  rotulos: Record<PassoDoTrilho, string>;
}) {
  const indiceAtual = ORDEM.indexOf(atual);
  return (
    <ol className="flex items-center gap-1" data-testid="ia-passos">
      {ORDEM.map((passo, i) => {
        const cumprido = i < indiceAtual;
        const ativo = i === indiceAtual;
        return (
          <li key={passo} className="flex flex-1 items-center gap-1">
            <span
              aria-current={ativo ? "step" : undefined}
              data-estado={cumprido ? "cumprido" : ativo ? "ativo" : "pendente"}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium transition-colors",
                cumprido && "border-primary bg-primary text-primary-foreground",
                ativo && "border-primary text-primary",
                !cumprido && !ativo && "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {cumprido ? <Check className="size-3" weight="bold" /> : i + 1}
            </span>
            <span
              className={cn(
                "truncate text-[11px]",
                ativo ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {rotulos[passo]}
            </span>
            {i < ORDEM.length - 1 && (
              <span
                className={cn("h-px flex-1", cumprido ? "bg-primary" : "bg-border")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ──────────────────────────────────── chat ───────────────────────────────────

export function Bolha({ papel, children }: { papel: "usuario" | "ia"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "ia-surge flex",
        papel === "usuario" ? "justify-end" : "justify-start",
      )}
    >
      <p
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          papel === "usuario"
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * O estado de espera.
 *
 * Três blocos em forma de bolha, no lugar do `<p>Pensando…</p>` de antes. A
 * diferença não é enfeite: uma frase estática não distingue "está pensando" de
 * "travou", e essa dúvida é exatamente a que o painel produzia.
 */
export function Pensando({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-label={rotulo} data-testid="ia-pensando">
      <Skeleton className="h-8 w-3/5 rounded-2xl rounded-bl-sm" />
      <Skeleton className="h-8 w-4/5 rounded-2xl rounded-bl-sm" />
      <Skeleton className="h-8 w-2/5 rounded-2xl rounded-bl-sm" />
    </div>
  );
}

// ──────────────────────────────── opções ─────────────────────────────────────

/**
 * Uma opção de resposta, como CARTÃO clicável.
 *
 * `role="radio"` e navegação por seta porque é uma escolha única entre poucas —
 * um punhado de `<Button>` soltos não diz isso a quem usa leitor de tela, e a
 * versão anterior era exatamente isso.
 */
export function CartaoDeOpcao({
  texto,
  indice,
  selecionado,
  desabilitado,
  aoEscolher,
  aoNavegar,
}: {
  texto: string;
  indice: number;
  selecionado: boolean;
  desabilitado: boolean;
  aoEscolher: () => void;
  aoNavegar: (delta: number) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selecionado}
      disabled={desabilitado}
      data-testid="ia-opcao"
      onClick={aoEscolher}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          aoNavegar(1);
        }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          aoNavegar(-1);
        }
      }}
      // O atraso escalonado faz as opções entrarem em cascata em vez de piscarem
      // juntas — é o que dá a sensação de resposta chegando, e custa uma linha.
      style={{ animationDelay: `${Math.min(indice, 5) * 60}ms` }}
      className={cn(
        "ia-surge group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm",
        "hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selecionado && "border-primary bg-accent",
      )}
    >
      <span>{texto}</span>
      <Check
        className={cn(
          "size-4 shrink-0 text-primary transition-opacity",
          selecionado ? "opacity-100" : "opacity-0 group-hover:opacity-40",
        )}
      />
    </button>
  );
}

// ───────────────────────────── progresso da montagem ─────────────────────────

/**
 * O progresso da montagem — INDETERMINADO, e é o desenho honesto agora.
 *
 * ⚠️ ERA UMA BARRA COM PORCENTAGEM (`concluidos / total`), alimentada pelos
 * eventos SSE da rota de montagem. O stream saiu do produto: numa VPS real ele
 * nunca chegava ao navegador, e a tela travava em "Montando N blocos…" para
 * sempre — ver o cabeçalho de `useGeracaoDeFluxo.ts`.
 *
 * Sem os eventos não existe fração para mostrar, e inventar uma (uma barra que
 * anda sozinha por tempo) seria pior que não ter: ela mentiria sobre onde a
 * geração está, que é exatamente o defeito que esta frente veio consertar.
 *
 * `role="progressbar"` SEM `aria-valuenow` é a forma que o ARIA define para
 * "indeterminado" — o leitor de tela anuncia "em progresso" em vez de ler uma
 * porcentagem falsa.
 *
 * A animação é CSS à mão (`.barra-indeterminada`, em `app/globals.css`), e não
 * uma classe utilitária: `tailwindcss-animate` NÃO está instalado neste repo
 * (`plugins: []` no tailwind.config.ts). A dívida que este comentário registrava
 * — as `animate-in`/`fade-in` usadas acima, que não existiam e não faziam nada —
 * foi paga: viraram `.ia-surge`/`.ia-aparece`, no mesmo padrão desta barra.
 */
export function ProgressoDaMontagem({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex flex-col gap-2" data-testid="ia-progresso">
      <div className="flex items-center gap-2 text-sm">
        <Sparkle className="size-4 shrink-0 animate-pulse text-primary" />
        <span className="text-muted-foreground">{rotulo}</span>
      </div>
      <div
        role="progressbar"
        aria-label={rotulo}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="barra-indeterminada h-full w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  );
}

// ─────────────────────────── resposta escrita ────────────────────────────────

/**
 * O campo de resposta livre — e o botão de pular.
 *
 * ⚠️ ANTES SÓ HAVIA CARTÃO. Toda pergunta vinha com 2 a 5 opções porque o
 * servidor recusava qualquer outra coisa, e para perguntar "qual o texto da
 * mensagem?" o modelo tinha de INVENTAR três textos. A pessoa então escolhia
 * entre três frases que não eram as dela, ou desistia da IA e montava à mão.
 *
 * Fica ao lado dos cartões, e não no lugar deles: quando a resposta É uma lista
 * curta, clicar continua sendo mais rápido do que digitar.
 */
export function CampoDeResposta({
  rotulo,
  aoResponder,
  aoPular,
  desabilitado,
  rotuloDoBotao,
  rotuloDePular,
  placeholder,
}: {
  rotulo: string;
  aoResponder: (texto: string) => void;
  aoPular: () => void;
  desabilitado: boolean;
  rotuloDoBotao: string;
  rotuloDePular: string;
  placeholder: string;
}) {
  const [texto, setTexto] = React.useState("");

  function enviar() {
    const limpo = texto.trim();
    if (limpo.length === 0) return;
    setTexto("");
    aoResponder(limpo);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          disabled={desabilitado}
          placeholder={placeholder}
          aria-label={rotulo}
          data-testid="ia-resposta-livre"
        />
        <Button
          size="icon"
          onClick={enviar}
          disabled={desabilitado || texto.trim().length === 0}
          aria-label={rotuloDoBotao}
          data-testid="ia-enviar-resposta"
        >
          <PaperPlaneTilt className="size-4" />
        </Button>
      </div>
      {/* Pular é uma resposta, e não um abandono: manda "escolha um padrão" ao
          modelo em vez de deixar a conversa sem saída quando a pergunta não
          importa para quem está montando. */}
      <button
        type="button"
        onClick={aoPular}
        disabled={desabilitado}
        data-testid="ia-pular"
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <SkipForward className="size-3" />
        {rotuloDePular}
      </button>
    </div>
  );
}

// ──────────────────────── o plano, antes de virar quadro ─────────────────────

export interface BlocoDoPreview {
  id: string;
  rotulo: string;
  intencao: string;
}

/**
 * A LISTA DE BLOCOS antes de montar.
 *
 * ⚠️ O único "preview" era o resumo em prosa, de uma ou duas frases, e logo
 * depois o canvas era SUBSTITUÍDO INTEIRO. Quem tinha um rascunho no quadro
 * apertava "Montar o fluxo" sem saber o que ia receber no lugar dele.
 *
 * A informação já estava toda na mão — `plano.blocos` chega inteiro da etapa 1,
 * com `rotulo` e `intencao` por bloco. Mostrá-la não custa uma chamada a mais;
 * custava a etapa 1 e a 2 estarem coladas numa função só, e é por isso que
 * `useGeracaoDeFluxo` passou a ter `planejar()` e `montar()` separados.
 */
export function ListaDoPlano({
  blocos,
  titulo,
}: {
  blocos: readonly BlocoDoPreview[];
  titulo: string;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="ia-plano">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <ol className="flex flex-col gap-1.5">
        {blocos.map((bloco, i) => (
          <li
            key={bloco.id}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            className="ia-surge flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{bloco.rotulo}</span>
              {/* A intenção é o que a etapa 1 escreveu para permitir preencher os
                  campos depois — mostrá-la é o que transforma "9 blocos" em algo
                  que dá para conferir antes de aceitar. */}
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {bloco.intencao}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ───────────────────── o que foi arrumado, e o que falta ─────────────────────

/**
 * O que o produto consertou sozinho no fluxo gerado.
 *
 * Dizer isto é obrigação, não cortesia: o reparo mexe em ligações e em campo de
 * bloco. Um conserto silencioso vira "eu não pedi isso" na primeira vez que
 * alguém compara o quadro com o que descreveu.
 */
export function Consertos({
  itens,
  titulo,
}: {
  itens: readonly { ancora: string; oQueFoiFeito: string }[];
  titulo: string;
}) {
  if (itens.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-2.5" data-testid="ia-consertos">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Info className="size-3.5 shrink-0 text-muted-foreground" />
        {titulo}
      </p>
      <ul className="flex flex-col gap-1">
        {itens.map((item, i) => (
          <li key={`${item.ancora}-${i}`} className="text-[11px] leading-snug text-muted-foreground">
            {item.oQueFoiFeito}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * O que AINDA impede publicar.
 *
 * ⚠️ Sem esta lista, a pessoa descobria o problema clicando em Publicar — em
 * vocabulário de motor, sobre um fluxo que ela não escreveu. Dizer aqui, com o
 * bloco nomeado, é a diferença entre "a IA errou" e "falta escolher a conexão
 * no bloco de disparo".
 */
export function Pendencias({
  itens,
  titulo,
}: {
  itens: readonly { ancora: string; mensagem: string }[];
  titulo: string;
}) {
  if (itens.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5"
      data-testid="ia-pendencias"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <Warning className="size-3.5 shrink-0" />
        {titulo}
      </p>
      <ul className="flex flex-col gap-1">
        {itens.map((item, i) => (
          <li
            key={`${item.ancora}-${i}`}
            className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground"
          >
            <ArrowRight className="mt-0.5 size-3 shrink-0" />
            {item.mensagem}
          </li>
        ))}
      </ul>
    </div>
  );
}
