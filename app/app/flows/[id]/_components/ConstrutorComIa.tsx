"use client";

import { useObject } from "@ai-sdk/react";
import type { Edge, Node } from "@xyflow/react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { autoLayout } from "@/lib/flow-engine/ai/auto-layout";
import { montarSchemaDeGeracao } from "@/lib/flow-engine/ai/generation-schema";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";
import { Sparkle, Warning, X } from "@/lib/ui/icons";

import type { DadosDoNo } from "./NoDoFluxo";

/**
 * O painel "Criar com IA" — DENTRO do mesmo editor, nunca uma tela separada.
 *
 * Quatro estados internos: `entrada` (a pessoa descreve o que quer) →
 * `perguntas` (0 a N rodadas de esclarecimento, sempre por múltipla escolha)
 * → `construindo` (streaming de verdade: o CANVAS REAL recebe os nós
 * conforme a IA os produz, travado para interação) → `concluido`.
 *
 * ═══ Por que o histórico da conversa some ao fechar o painel ═══
 *
 * Decisão do dono do produto: sem tabela nova para isto. O estado vive só
 * neste componente (`useState`); recarregar a página ou navegar para outro
 * fluxo perde a conversa — a pessoa recomeça. O que NÃO se perde é o próprio
 * fluxo: uma vez que os nós entram no canvas, eles são `nos`/`arestas` do
 * `Quadro` como qualquer outro, e "Salvar rascunho" funciona normal.
 */

type Passo = "fechado" | "entrada" | "perguntas" | "construindo" | "concluido";

interface Mensagem {
  papel: "usuario" | "ia";
  texto: string;
}

interface RespostaInterpretar {
  kind: "perguntar" | "pronto";
  pergunta?: string;
  opcoes?: string[];
  resumo?: string;
}

/**
 * O schema de geração serve às DUAS pontas (`useObject` aqui, `streamObject`
 * na rota) porque `montarSchemaDeGeracao` é TypeScript puro sem I/O — o
 * mesmo registry que a paleta do editor já importa no cliente hoje.
 */
function useSchemaDeGeracao() {
  return React.useMemo(() => {
    garantirNosRegistrados();
    return montarSchemaDeGeracao();
  }, []);
}

type NoParcial = { id?: string; type?: string; label?: string; config?: unknown };
type ArestaParcial = { id?: string; source?: string; target?: string; branch_id?: string };

/**
 * Converte o objeto PARCIAL (ainda incompleto, chegando aos pedaços) no
 * `nos`/`arestas` que o `<ReactFlow>` de verdade desenha.
 *
 * Um nó só entra quando tem `id` E `type` — sem os dois não há o que
 * desenhar nem onde ancorar uma aresta. `config`/`label` incompletos caem em
 * `{}`/no rótulo do registry, a MESMA tolerância que `ramosDoTipo`
 * (FlowCanvas.tsx) já pratica para nó em edição manual.
 */
function paraReactFlowParcial(
  nosParciais: readonly (NoParcial | undefined)[],
  arestasParciais: readonly (ArestaParcial | undefined)[],
): { nos: Node[]; arestas: Edge[] } {
  const prontos = nosParciais.filter(
    (n): n is NoParcial & { id: string; type: string } =>
      n !== undefined && typeof n.id === "string" && typeof n.type === "string",
  );

  const posicoes = autoLayout(
    prontos.map((n) => ({ id: n.id, type: n.type })),
    arestasParciais
      .filter(
        (a): a is ArestaParcial & { source: string; target: string } =>
          a !== undefined && typeof a.source === "string" && typeof a.target === "string",
      )
      .map((a) => ({ source: a.source, target: a.target })),
  );

  const nos: Node[] = prontos.map((n) => {
    const def = buscarNo(n.type);
    const config = n.config ?? {};
    let branches: DadosDoNo["branches"] = [];
    try {
      branches = def?.branches(config as never) ?? [];
    } catch {
      // Config ainda incompleta a meio do streaming — sem saídas por ora,
      // elas aparecem no próximo pedaço do objeto parcial.
      branches = [];
    }
    return {
      id: n.id,
      type: "fluxo",
      position: posicoes[n.id] ?? { x: 0, y: 0 },
      data: {
        rotulo: n.label ?? def?.rotulo ?? n.type,
        tipo: n.type,
        categoria: def?.category ?? "logic",
        branches,
        config,
        recemAdicionado: true,
      } satisfies DadosDoNo & { config: unknown },
    };
  });

  const idsProntos = new Set(prontos.map((n) => n.id));
  const arestas: Edge[] = arestasParciais
    .filter(
      (a): a is Required<ArestaParcial> =>
        a !== undefined &&
        typeof a.id === "string" &&
        typeof a.source === "string" &&
        typeof a.target === "string" &&
        typeof a.branch_id === "string" &&
        idsProntos.has(a.source) &&
        idsProntos.has(a.target),
    )
    .map((a) => ({ id: a.id, source: a.source, target: a.target, sourceHandle: a.branch_id }));

  return { nos, arestas };
}

export interface ConstrutorComIaProps {
  flowId: string;
  /** Substitui o grafo do canvas em tempo real — o MESMO `nos`/`arestas` do editor. */
  onAtualizarCanvas: (grafo: { nos: Node[]; arestas: Edge[] }) => void;
  /** O canvas antes de começar a gerar — para "Cancelar" desfazer sem perda. */
  grafoAntesDeGerar: () => { nos: Node[]; arestas: Edge[] };
  /** A tela inteira (paleta, Salvar, Publicar) escuta isto para travar durante `construindo`. */
  onMudarBloqueio: (bloqueado: boolean) => void;
}

export function ConstrutorComIa({
  flowId,
  onAtualizarCanvas,
  grafoAntesDeGerar,
  onMudarBloqueio,
}: ConstrutorComIaProps) {
  const t = useT();
  const schema = useSchemaDeGeracao();

  const [passo, setPasso] = React.useState<Passo>("fechado");
  const [pedido, setPedido] = React.useState("");
  const [historico, setHistorico] = React.useState<Mensagem[]>([]);
  const [perguntaAtual, setPerguntaAtual] = React.useState<{ texto: string; opcoes: string[] } | null>(
    null,
  );
  const [resumo, setResumo] = React.useState<string | null>(null);
  const [interpretando, setInterpretando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const snapshotAntesDeGerar = React.useRef<{ nos: Node[]; arestas: Edge[] } | null>(null);

  const { object, submit, stop, error: erroDeGeracao } = useObject({
    api: `/api/v1/flows/${flowId}/ai/gerar`,
    schema,
    onFinish: ({ object: final }) => {
      onMudarBloqueio(false);
      if (final) {
        toast.success(
          t("Fluxo montado com {n} blocos — confira e publique quando quiser.").replace(
            "{n}",
            String(final.nodes.length),
          ),
        );
        setPasso("concluido");
      } else {
        toast.error(t("A IA não conseguiu terminar o fluxo. Tente descrever de outro jeito."));
        if (snapshotAntesDeGerar.current) onAtualizarCanvas(snapshotAntesDeGerar.current);
        setPasso("entrada");
      }
    },
  });

  // Alimenta o canvas DE VERDADE a cada pedaço novo do streaming — é aqui que
  // "constrói ao vivo" vira pixel, não só promessa de UI.
  React.useEffect(() => {
    if (passo !== "construindo" || !object) return;
    onAtualizarCanvas(paraReactFlowParcial(object.nodes ?? [], object.edges ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object, passo]);

  // Efeito legítimo, não candidato a "computar durante a renderização": ele
  // sincroniza com um ERRO EXTERNO (o fetch de `useObject` falhou) e reage com
  // efeitos colaterais de verdade — toast, reverter o canvas do PAI, destravar
  // a tela — nenhum dos quais é estado derivável no corpo do render. É
  // exatamente o caso que a doc do React chama de aceitável: "subscribe for
  // updates from an external system, calling setState in a callback".
  React.useEffect(() => {
    if (erroDeGeracao) {
      toast.error(t("A geração falhou. Tente de novo."));
      onMudarBloqueio(false);
      if (snapshotAntesDeGerar.current) onAtualizarCanvas(snapshotAntesDeGerar.current);
      setPasso("entrada");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erroDeGeracao]);

  function fechar() {
    setPasso("fechado");
    setPedido("");
    setHistorico([]);
    setPerguntaAtual(null);
    setResumo(null);
    setErro(null);
  }

  async function interpretar(historicoAtual: Mensagem[]) {
    setInterpretando(true);
    setErro(null);
    try {
      const resposta = await apiClient.post<{ data: RespostaInterpretar }>(
        `/api/v1/flows/${flowId}/ai/interpretar`,
        { pedido, historico: historicoAtual },
        // O teto padrão do cliente é 10s, medida boa para uma rota nossa e
        // curta demais para uma que espera um provedor de IA responder: a
        // chamada era abandonada no meio, e o que a pessoa via não tinha nada a
        // ver com o que estava acontecendo do outro lado.
        { timeoutMs: 120_000 },
      );
      if (resposta.data.kind === "perguntar") {
        setPerguntaAtual({
          texto: resposta.data.pergunta ?? "",
          opcoes: resposta.data.opcoes ?? [],
        });
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

  async function escolherOpcao(opcao: string) {
    if (!perguntaAtual) return;
    const novoHistorico: Mensagem[] = [
      ...historico,
      { papel: "ia", texto: perguntaAtual.texto },
      { papel: "usuario", texto: opcao },
    ];
    setHistorico(novoHistorico);
    setPerguntaAtual(null);
    await interpretar(novoHistorico);
  }

  function comecarAConstruir() {
    snapshotAntesDeGerar.current = grafoAntesDeGerar();
    onMudarBloqueio(true);
    setPasso("construindo");
    submit({ pedido, historico });
  }

  function cancelar() {
    stop();
    onMudarBloqueio(false);
    if (snapshotAntesDeGerar.current) onAtualizarCanvas(snapshotAntesDeGerar.current);
    fechar();
  }

  if (passo === "fechado") {
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
      className="absolute inset-0 z-10 flex items-start justify-center bg-background/80 p-6 backdrop-blur-sm"
      data-testid="construtor-com-ia"
    >
      <div className="mt-12 flex w-full max-w-md flex-col gap-4 rounded-lg border bg-background p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkle className="size-4" />
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

        {passo === "entrada" && (
          <div className="flex flex-col gap-3">
            <Textarea
              autoFocus
              rows={4}
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              placeholder={t(
                "Ex.: quando um lead novo entrar, espera 10 minutos e, se ninguém tiver falado com ele, avisa o vendedor no WhatsApp.",
              )}
              data-testid="ia-pedido"
            />
            {erro && (
              <p className="text-xs text-destructive" data-testid="ia-erro">
                {erro}
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

        {passo === "perguntas" && (
          <div className="flex flex-col gap-3">
            {/* Histórico da conversa, tipo chat. */}
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">{pedido}</p>
              {historico.map((m, i) => (
                <p
                  key={i}
                  className={m.papel === "ia" ? "font-medium" : "self-end text-muted-foreground"}
                >
                  {m.texto}
                </p>
              ))}
            </div>

            {/* Sem isto, entre escolher uma opção e a próxima pergunta chegar,
                a tela fica sem pergunta, sem resumo e sem sinal nenhum de que
                algo está acontecendo — parece travada por um instante. */}
            {interpretando && !perguntaAtual && !resumo && (
              <p className="text-sm text-muted-foreground">{t("Pensando…")}</p>
            )}

            {perguntaAtual && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{perguntaAtual.texto}</p>
                <div className="flex flex-wrap gap-2">
                  {perguntaAtual.opcoes.map((opcao) => (
                    <Button
                      key={opcao}
                      variant="outline"
                      size="sm"
                      disabled={interpretando}
                      onClick={() => escolherOpcao(opcao)}
                    >
                      {opcao}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {resumo && (
              <div className="flex flex-col gap-3">
                <p className="text-sm">{resumo}</p>
                <Button onClick={comecarAConstruir}>{t("Montar o fluxo")}</Button>
              </div>
            )}

            {erro && <p className="text-xs text-destructive">{erro}</p>}
          </div>
        )}

        {passo === "construindo" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Sparkle className="size-6 animate-pulse text-primary" />
            <p className="text-sm text-muted-foreground">
              {t("Construindo o fluxo… {n} blocos até agora.").replace(
                "{n}",
                String(object?.nodes?.length ?? 0),
              )}
            </p>
            <Button variant="ghost" size="sm" onClick={cancelar}>
              {t("Cancelar")}
            </Button>
          </div>
        )}

        {passo === "concluido" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t("Pronto. Confira os blocos no quadro, ajuste o que quiser e salve o rascunho.")}
            </p>
            <Button onClick={fechar}>{t("Fechar")}</Button>
          </div>
        )}

        {passo !== "construindo" && passo !== "concluido" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Warning className="mt-0.5 size-3 shrink-0" />
            {t("A conversa se perde se você sair desta tela antes de montar o fluxo.")}
          </p>
        )}
      </div>
    </div>
  );
}
