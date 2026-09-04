"use client";

import type { Edge, Node } from "@xyflow/react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { buscarNo } from "@/lib/flow-engine/registry";
import type { FlowGraph } from "@/lib/flow-engine/graph-schema";
import { ArrowRight, Sparkle, Warning, X } from "@/lib/ui/icons";

import {
  Bolha,
  CampoDeResposta,
  CartaoDeOpcao,
  Consertos,
  ListaDoPlano,
  PassosDaGeracao,
  Pendencias,
  Pensando,
  ProgressoDaMontagem,
  type PassoDoTrilho,
} from "./ia/Pecas";
import { useGeracaoDeFluxo, type Mensagem } from "./ia/useGeracaoDeFluxo";
import type { DadosDoNo } from "./NoDoFluxo";

/**
 * O painel "Criar fluxo com IA" — DENTRO do mesmo editor, nunca uma tela separada.
 *
 * ═══ Duas etapas, não uma ═══
 *
 * `ai/plano` decide QUAIS blocos e `ai/montar` preenche cada um. As DUAS são
 * respostas JSON com status HTTP de verdade. O caminho anterior pedia o grafo
 * inteiro numa resposta só, com um schema de 8.645 bytes e união de 11
 * variantes: um `config` divergente entre vinte blocos apagava o fluxo inteiro,
 * e qualquer causa — inclusive "não há provedor configurado" — chegava aqui como
 * a mesma frase genérica.
 *
 * ⚠️ `ai/montar` ERA UM STREAM SSE, com os blocos acendendo um a um. Numa VPS
 * real ele nunca chegava ao navegador e a tela travava em "Montando N blocos…"
 * para sempre. O diagnóstico e a medição estão em `ia/useGeracaoDeFluxo.ts`.
 *
 * ═══ ⚠️ VER ANTES DE ACEITAR ═══
 *
 * Este painel SUBSTITUI o grafo do canvas — não faz merge. Enquanto a etapa 1 e
 * a etapa 2 rodavam coladas, a pessoa apertava "Montar o fluxo" tendo lido
 * apenas um resumo de uma frase, e o rascunho dela sumia. Hoje há um passo entre
 * as duas: a lista dos blocos que vão ser criados, com o que cada um faz. A
 * informação sempre esteve na mão — o plano traz `rotulo` e `intencao` por
 * bloco —, e mostrá-la não custa uma chamada a mais.
 *
 * E o desfazer sobrevive ao fim: `snapshotAntesDeGerar` só é descartado quando o
 * painel fecha, então "Descartar" existe também DEPOIS de a montagem terminar.
 * Antes só dava para desfazer durante a construção, o que é o inverso de quando
 * a pessoa sabe se gostou do resultado.
 *
 * ═══ Por que o histórico da conversa some ao fechar o painel ═══
 *
 * Decisão do dono do produto: sem tabela nova para isto. O estado vive só neste
 * componente; recarregar a página perde a conversa. O que NÃO se perde é o
 * fluxo: uma vez no canvas, os nós são `nos`/`arestas` como quaisquer outros, e
 * "Salvar rascunho" funciona normal.
 */

type Passo = "fechado" | "entrada" | "perguntas" | "plano" | "construindo" | "concluido";

interface RespostaInterpretar {
  kind: "perguntar" | "pronto";
  pergunta?: string;
  opcoes?: string[];
  resposta_livre?: boolean;
  resumo?: string;
}

/**
 * O grafo do servidor vira o `nos`/`arestas` que o `<ReactFlow>` desenha.
 *
 * Substitui o `paraReactFlowParcial` de antes, que existia para lidar com um
 * objeto PARCIAL chegando aos pedaços. Agora o grafo chega inteiro e já
 * validado (`flowGraphSchema` no servidor), então a tolerância a campo ausente
 * deixou de ser necessária — o que sobra é traduzir a forma.
 */
function paraReactFlow(grafo: FlowGraph): { nos: Node[]; arestas: Edge[] } {
  const nos: Node[] = grafo.nodes.map((n) => {
    const def = buscarNo(n.type);
    let branches: DadosDoNo["branches"] = [];
    try {
      branches = def?.branches(n.config as never) ?? [];
    } catch {
      // Config que o `branches()` recusa: sem saídas por ora. Mesma tolerância
      // que `ramosDoTipo` (FlowCanvas.tsx) já pratica no nó em edição manual.
      branches = [];
    }
    return {
      id: n.id,
      type: "fluxo",
      position: n.position,
      data: {
        rotulo: n.label,
        tipo: n.type,
        categoria: def?.category ?? "logic",
        branches,
        config: n.config,
        recemAdicionado: true,
      } satisfies DadosDoNo & { config: unknown },
    };
  });

  const arestas: Edge[] = grafo.edges.map((a) => ({
    id: a.id,
    source: a.source,
    target: a.target,
    sourceHandle: a.branch_id,
  }));

  return { nos, arestas };
}

export interface ConstrutorComIaProps {
  flowId: string;
  /** Substitui o grafo do canvas em tempo real — o MESMO `nos`/`arestas` do editor. */
  onAtualizarCanvas: (grafo: { nos: Node[]; arestas: Edge[] }) => void;
  /** O canvas antes de começar a gerar — para "Descartar" desfazer sem perda. */
  grafoAntesDeGerar: () => { nos: Node[]; arestas: Edge[] };
  /** A tela inteira (paleta, Salvar, Publicar) escuta isto para travar durante a montagem. */
  onMudarBloqueio: (bloqueado: boolean) => void;
}

export function ConstrutorComIa({
  flowId,
  onAtualizarCanvas,
  grafoAntesDeGerar,
  onMudarBloqueio,
}: ConstrutorComIaProps) {
  const t = useT();

  const [passo, setPasso] = React.useState<Passo>("fechado");
  const [pedido, setPedido] = React.useState("");
  const [historico, setHistorico] = React.useState<Mensagem[]>([]);
  const [perguntaAtual, setPerguntaAtual] = React.useState<{
    texto: string;
    opcoes: string[];
    aberta: boolean;
  } | null>(null);
  const [escolhida, setEscolhida] = React.useState<string | null>(null);
  const [resumo, setResumo] = React.useState<string | null>(null);
  const [interpretando, setInterpretando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const snapshotAntesDeGerar = React.useRef<{ nos: Node[]; arestas: Edge[] } | null>(null);
  const opcoesRef = React.useRef<HTMLDivElement | null>(null);
  const fimDaConversaRef = React.useRef<HTMLDivElement | null>(null);

  const aplicarGrafo = React.useCallback(
    (grafo: FlowGraph) => onAtualizarCanvas(paraReactFlow(grafo)),
    [onAtualizarCanvas],
  );
  const geracao = useGeracaoDeFluxo(flowId, aplicarGrafo);
  /**
   * O passo VISÍVEL é derivado, não guardado.
   *
   * Guardá-lo obrigaria o efeito abaixo a chamar `setPasso` — e `setState`
   * dentro de efeito é render em cascata, além de duplicar em estado local algo
   * que `geracao.fase` já diz com precisão. O efeito fica só com o que é de
   * fato efeito colateral: destravar a tela, avisar, desfazer o canvas.
   */
  const passoVisivel: Passo =
    passo === "plano" && geracao.fase === "falhou"
      ? "perguntas"
      : passo === "construindo" && geracao.fase === "pronto"
        ? "concluido"
        : passo === "construindo" && geracao.fase === "falhou"
          ? "perguntas"
          : passo;

  /**
   * O erro da tela: o meu, ou o que o SERVIDOR explicou.
   *
   * A frase do servidor é o ponto: ela distingue "nenhum provedor configurado"
   * — conserto de um clique — de "o modelo recusou o pedido". A tela antiga
   * trocava as duas por "A geração falhou. Tente de novo.".
   */
  const erroVisivel = erro ?? (geracao.fase === "falhou" ? geracao.erro : null);

  // Sincroniza com um sistema EXTERNO (a montagem terminou) e faz só efeito
  // colateral — nenhum `setState`.
  React.useEffect(() => {
    // O bloqueio começa em "ver o plano" — dali em diante a IA está trabalhando
    // sobre o quadro —, então destravar tem de cobrir os dois passos: uma falha
    // no PLANO deixava a paleta e o Salvar mortos quando só o "construindo"
    // era observado aqui.
    if (passo !== "construindo" && passo !== "plano") return;
    if (geracao.fase === "pronto") {
      onMudarBloqueio(false);
      toast.success(
        t("Fluxo montado com {n} blocos — confira e publique quando quiser.").replace(
          "{n}",
          String(geracao.grafo?.nodes.length ?? 0),
        ),
      );
      return;
    }
    if (geracao.fase === "falhou") {
      onMudarBloqueio(false);
      // ⚠️ SÓ DESFAZ QUANDO NÃO SOBROU NADA. Antes, qualquer falha restaurava o
      // snapshot e a pessoa perdia até o esqueleto — um grafo válido, com os
      // blocos certos em valores padrão, que ela poderia terminar à mão. Apagar
      // trabalho utilizável para mostrar uma mensagem de erro é o oposto do que
      // este painel deve fazer.
      if (!geracao.somenteEsqueleto && snapshotAntesDeGerar.current) {
        onAtualizarCanvas(snapshotAntesDeGerar.current);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geracao.fase, passo]);

  // A conversa cresce para baixo dentro de uma caixa com rolagem própria; sem
  // isto, a resposta nova nasce fora da vista e o painel parece não ter feito
  // nada. `block: "nearest"` não puxa a página inteira junto.
  React.useEffect(() => {
    const fim = fimDaConversaRef.current;
    // `typeof` e não `?.`: o jsdom não implementa `scrollIntoView`, e sem esta
    // guarda o efeito derruba o componente inteiro dentro do teste — um erro de
    // ambiente de teste apagando a tela que o teste veio medir.
    if (fim && typeof fim.scrollIntoView === "function") fim.scrollIntoView({ block: "nearest" });
  }, [historico.length, perguntaAtual, resumo, interpretando]);

  const fechar = React.useCallback(() => {
    setPasso("fechado");
    setPedido("");
    setHistorico([]);
    setPerguntaAtual(null);
    setEscolhida(null);
    setResumo(null);
    setErro(null);
    snapshotAntesDeGerar.current = null;
    geracao.reiniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geracao.reiniciar]);

  // `Esc` fecha, menos durante a montagem: ali fechar deixaria a geração
  // correndo sem tela nenhuma para dizer o que aconteceu com ela.
  React.useEffect(() => {
    if (passo === "fechado" || passo === "construindo") return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        fechar();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [passo, fechar]);

  async function interpretar(historicoAtual: Mensagem[]) {
    setInterpretando(true);
    setErro(null);
    try {
      const resposta = await apiClient.post<{ data: RespostaInterpretar }>(
        `/api/v1/flows/${flowId}/ai/interpretar`,
        { pedido, historico: historicoAtual },
        // O teto padrão do cliente é 10s, medida boa para uma rota nossa e curta
        // demais para uma que espera um provedor de IA responder.
        { timeoutMs: 120_000 },
      );
      if (resposta.data.kind === "perguntar") {
        setPerguntaAtual({
          texto: resposta.data.pergunta ?? "",
          opcoes: resposta.data.opcoes ?? [],
          // Pergunta sem opções é aberta por construção — a bandeira do servidor
          // é a intenção, e a lista vazia é o fato; aceitar os dois evita uma
          // tela sem caminho se um deles vier faltando.
          aberta: resposta.data.resposta_livre === true || (resposta.data.opcoes?.length ?? 0) === 0,
        });
        setEscolhida(null);
        setResumo(null);
        setPasso("perguntas");
      } else {
        setPerguntaAtual(null);
        setResumo(resposta.data.resumo ?? "");
        setPasso("perguntas");
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : t("Não consegui entender o pedido."));
    } finally {
      setInterpretando(false);
    }
  }

  async function continuarDaEntrada() {
    if (!pedido.trim()) return;
    await interpretar([]);
  }

  /** Uma resposta — de cartão ou digitada — entra igual no histórico. */
  async function responder(texto: string) {
    if (!perguntaAtual) return;
    setEscolhida(texto);
    const novoHistorico: Mensagem[] = [
      ...historico,
      { papel: "ia", texto: perguntaAtual.texto },
      { papel: "usuario", texto },
    ];
    setHistorico(novoHistorico);
    setPerguntaAtual(null);
    await interpretar(novoHistorico);
  }

  /**
   * Voltar uma resposta.
   *
   * Tira o par pergunta/resposta do fim e reinterpreta. Sem isto, clicar na
   * opção errada obrigava a fechar o painel e recomeçar a descrição do zero —
   * e a conversa não é persistida, então recomeçar é literal.
   */
  async function corrigirUltima() {
    if (historico.length < 2) return;
    const anterior = historico.slice(0, -2);
    setHistorico(anterior);
    setPerguntaAtual(null);
    setResumo(null);
    setEscolhida(null);
    await interpretar(anterior);
  }

  /** Setas navegam entre os cartões — é uma escolha única, não botões soltos. */
  function navegarOpcoes(delta: number) {
    const alvos = opcoesRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (!alvos || alvos.length === 0) return;
    const atual = document.activeElement;
    const indice = [...alvos].findIndex((el) => el === atual);
    const proximo = (indice + delta + alvos.length) % alvos.length;
    alvos[proximo]?.focus();
  }

  async function verOPlano() {
    // O snapshot é tirado AQUI, e não na montagem: a partir deste ponto o
    // esqueleto pode chegar ao canvas, e o "Descartar" precisa do quadro
    // anterior para ter o que restaurar.
    snapshotAntesDeGerar.current = grafoAntesDeGerar();
    onMudarBloqueio(true);
    setErro(null);
    setPasso("plano");
    await geracao.planejar(pedido, historico);
  }

  function comecarAConstruir() {
    onMudarBloqueio(true);
    setErro(null);
    setPasso("construindo");
    void geracao.montar(pedido);
  }

  function cancelar() {
    geracao.cancelar();
    onMudarBloqueio(false);
    if (snapshotAntesDeGerar.current) onAtualizarCanvas(snapshotAntesDeGerar.current);
    fechar();
  }

  /** Depois de pronto: devolve o quadro ao que era antes de a IA mexer. */
  function descartar() {
    if (snapshotAntesDeGerar.current) onAtualizarCanvas(snapshotAntesDeGerar.current);
    toast.success(t("O quadro voltou ao que era antes."));
    fechar();
  }

  const passoDoTrilho: PassoDoTrilho =
    passo === "entrada"
      ? "descrever"
      : passo === "perguntas"
        ? "esclarecer"
        : passo === "plano"
          ? "planejar"
          : "montar";

  const rotulosDoTrilho: Record<PassoDoTrilho, string> = {
    descrever: t("Descrever"),
    esclarecer: t("Ajustar"),
    planejar: t("Planejar"),
    montar: t("Montar"),
  };

  if (passoVisivel === "fechado") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPasso("entrada")}
        data-testid="abrir-construtor-ia"
      >
        <Sparkle className="mr-2 size-4" />
        {t("Criar com IA")}
      </Button>
    );
  }

  return (
    <div
      className="ia-aparece absolute inset-0 z-10 flex items-start justify-center bg-background/80 p-3 backdrop-blur-sm sm:p-6"
      data-testid="construtor-com-ia"
    >
      {/*
        `max-h` + rolagem SÓ NA CONVERSA, e não no cartão inteiro.

        ⚠️ O cartão não tinha altura máxima nem `overflow` nenhum, dentro de um
        pai `absolute inset-0` de altura travada pelo `FlowBuilder`. Conversa de
        quatro trocas, ou uma pergunta com cinco opções, crescia PARA FORA da
        viewport — sem barra de rolagem, sem como chegar ao botão. O painel
        ficava inutilizável exatamente quando a conversa estava rendendo.

        A rolagem fica na conversa para o cabeçalho, o trilho de passos e os
        botões continuarem visíveis: rolar o cartão inteiro esconderia o botão
        que a pessoa está procurando.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Criar fluxo com IA")}
        className="ia-surge mt-4 flex max-h-full w-full max-w-md flex-col gap-4 overflow-hidden rounded-xl border bg-background p-4 shadow-lg sm:mt-12 sm:max-w-lg"
      >
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkle className="size-4 text-primary" />
            {t("Criar fluxo com IA")}
          </p>
          {passo !== "construindo" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={fechar}
              aria-label={t("Fechar")}
              data-testid="ia-fechar"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        <PassosDaGeracao atual={passoDoTrilho} rotulos={rotulosDoTrilho} />

        {passoVisivel === "entrada" && (
          <div className="flex flex-col gap-3">
            <Textarea
              autoFocus
              rows={4}
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              maxLength={2000}
              placeholder={t(
                "Ex.: quando um lead novo entrar, espera 10 minutos e, se ninguém tiver falado com ele, avisa o vendedor no WhatsApp.",
              )}
              data-testid="ia-pedido"
            />
            {/* O teto existe no servidor e a tela nunca o anunciava: um pedido
                longo voltava com "Descreva o que você quer", que manda consertar
                a coisa errada. O `maxLength` acima impede antes; o contador
                explica por quê. */}
            <p className="self-end text-[11px] tabular-nums text-muted-foreground">
              {pedido.length} / 2000
            </p>
            {erroVisivel && (
              <p className="text-xs text-destructive" data-testid="ia-erro">
                {erroVisivel}
              </p>
            )}
            <Button
              onClick={continuarDaEntrada}
              disabled={!pedido.trim() || interpretando}
              data-testid="ia-continuar"
            >
              {interpretando ? t("Pensando…") : t("Continuar")}
            </Button>
          </div>
        )}

        {passoVisivel === "perguntas" && (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" aria-live="polite">
              <Bolha papel="usuario">{pedido}</Bolha>
              {historico.map((m, i) => (
                <Bolha key={i} papel={m.papel}>
                  {m.texto}
                </Bolha>
              ))}

              {/* Sem isto, entre escolher uma opção e a próxima pergunta chegar, a
                  tela fica sem pergunta, sem resumo e sem sinal nenhum de que algo
                  está acontecendo — parece travada por um instante. */}
              {interpretando && !perguntaAtual && !resumo && <Pensando rotulo={t("Pensando…")} />}

              {perguntaAtual && (
                <div className="flex flex-col gap-2">
                  <Bolha papel="ia">{perguntaAtual.texto}</Bolha>
                  {perguntaAtual.opcoes.length > 0 && (
                    <div
                      ref={opcoesRef}
                      role="radiogroup"
                      aria-label={perguntaAtual.texto}
                      className="flex flex-col gap-1.5"
                    >
                      {perguntaAtual.opcoes.map((opcao, i) => (
                        <CartaoDeOpcao
                          key={opcao}
                          texto={opcao}
                          indice={i}
                          selecionado={escolhida === opcao}
                          desabilitado={interpretando}
                          aoEscolher={() => void responder(opcao)}
                          aoNavegar={navegarOpcoes}
                        />
                      ))}
                    </div>
                  )}
                  {/* O campo fica SEMPRE, e não só na pergunta aberta: mesmo
                      quando há opções, a resposta certa pode ser uma quarta
                      coisa — e obrigar a escolher entre três erradas é como a
                      conversa morria. */}
                  <CampoDeResposta
                    rotulo={perguntaAtual.texto}
                    desabilitado={interpretando}
                    aoResponder={(texto) => void responder(texto)}
                    aoPular={() =>
                      void responder(t("(sem preferência — escolha um padrão sensato)"))
                    }
                    rotuloDoBotao={t("Responder")}
                    rotuloDePular={t("Não tenho preferência")}
                    placeholder={
                      perguntaAtual.opcoes.length > 0
                        ? t("ou escreva sua resposta")
                        : t("escreva sua resposta")
                    }
                  />
                </div>
              )}

              {resumo && <Bolha papel="ia">{resumo}</Bolha>}
              <div ref={fimDaConversaRef} />
            </div>

            {historico.length >= 2 && !interpretando && (
              <button
                type="button"
                onClick={() => void corrigirUltima()}
                data-testid="ia-corrigir"
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t("Corrigir a última resposta")}
              </button>
            )}

            {resumo && (
              <Button onClick={() => void verOPlano()} data-testid="ia-ver-plano">
                <ArrowRight className="mr-2 size-4" />
                {t("Ver o que vai ser montado")}
              </Button>
            )}

            {erroVisivel && (
              <p className="text-xs text-destructive" data-testid="ia-erro">
                {erroVisivel}
              </p>
            )}

            {/* A MONTAGEM FALHOU E O ESQUELETO FICOU NO QUADRO.
                Dizer isso é o ponto: sem esta frase a pessoa lê "falhou", fecha
                o painel e não repara que os blocos certos já estão lá, ligados,
                esperando os campos. Um erro que esconde o trabalho que sobrou é
                pior que o erro. */}
            {geracao.somenteEsqueleto && (
              <div className="flex flex-col gap-2" data-testid="ia-so-esqueleto">
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Warning className="mt-0.5 size-3 shrink-0" />
                  {t(
                    "Os {n} blocos ficaram no quadro com valores padrão. Você pode fechar e preencher à mão, ou tentar montar de novo.",
                  ).replace("{n}", String(geracao.total))}
                </p>
                <Button variant="outline" onClick={fechar} data-testid="ia-preencher-a-mao">
                  {t("Fechar e preencher à mão")}
                </Button>
              </div>
            )}
          </div>
        )}

        {passoVisivel === "plano" && (
          <div className="flex min-h-0 flex-col gap-3">
            {geracao.fase === "planejando" && <Pensando rotulo={t("Montando o plano…")} />}
            {geracao.plano && (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ListaDoPlano
                    titulo={t("{n} blocos vão ser criados:").replace(
                      "{n}",
                      String(geracao.plano.blocos.length),
                    )}
                    blocos={geracao.plano.blocos.map((b) => ({
                      id: b.id,
                      rotulo: b.rotulo,
                      intencao: b.intencao,
                    }))}
                  />
                </div>
                {/* Dito antes, e não depois: este painel SUBSTITUI o quadro. */}
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Warning className="mt-0.5 size-3 shrink-0" />
                  {t("Isto substitui o que está no quadro agora. Dá para descartar depois.")}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setPasso("perguntas")}
                    data-testid="ia-voltar-do-plano"
                  >
                    {t("Voltar")}
                  </Button>
                  <Button className="flex-1" onClick={comecarAConstruir} data-testid="ia-montar">
                    <Sparkle className="mr-2 size-4" />
                    {t("Montar o fluxo")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {passoVisivel === "construindo" && (
          <div className="flex flex-col gap-3 py-1">
            {/* Sem os eventos por bloco não existe fração honesta para mostrar.
                O rótulo diz QUANTOS blocos estão sendo montados, que é a
                informação que a pessoa tem como usar — e não uma porcentagem
                inventada. */}
            <ProgressoDaMontagem
              rotulo={t("Montando {total} blocos — isso leva alguns segundos…").replace(
                "{total}",
                String(geracao.total),
              )}
            />
            <Button variant="ghost" size="sm" onClick={cancelar} data-testid="ia-cancelar">
              {t("Cancelar")}
            </Button>
          </div>
        )}

        {passoVisivel === "concluido" && (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <p className="text-sm">
                {geracao.pendencias.length === 0
                  ? t("Pronto. Confira os blocos no quadro, ajuste o que quiser e publique.")
                  : t("Pronto. Confira os blocos no quadro e resolva os pontos abaixo antes de publicar.")}
              </p>
              {/* Dizer isto é o ponto. Um bloco com valores padrão parece pronto e
                  não é — esconder o número repetiria o pecado de parecer que
                  funcionou, que é o que esta frente veio consertar. */}
              {geracao.comExemplo > 0 && (
                <p
                  className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  data-testid="ia-aviso-padrao"
                >
                  <Warning className="mt-0.5 size-3 shrink-0" />
                  {t("{n} blocos vieram com valores padrão — revise antes de publicar.").replace(
                    "{n}",
                    String(geracao.comExemplo),
                  )}
                </p>
              )}
              <Consertos itens={geracao.consertos} titulo={t("Ajustes feitos automaticamente")} />
              <Pendencias
                itens={geracao.pendencias}
                titulo={t("Ainda falta resolver, senão o fluxo não publica")}
              />
            </div>
            <div className="flex gap-2">
              {/* O desfazer sobrevive ao fim da montagem — antes só existia
                  DURANTE, que é justamente quando a pessoa ainda não sabe se
                  gostou do resultado. */}
              <Button
                variant="outline"
                className="flex-1"
                onClick={descartar}
                data-testid="ia-descartar"
              >
                {t("Descartar")}
              </Button>
              <Button className="flex-1" onClick={fechar} data-testid="ia-ficar-com">
                {t("Ficar com este fluxo")}
              </Button>
            </div>
          </div>
        )}

        {passoVisivel !== "construindo" && passoVisivel !== "concluido" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Warning className="mt-0.5 size-3 shrink-0" />
            {t("A conversa se perde se você sair desta tela antes de montar o fluxo.")}
          </p>
        )}
      </div>
    </div>
  );
}
