"use client";

import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { usePaletaDeNos, type NoDaPaleta } from "@/hooks/flows/useFlowNodes";
import { useFluxo, usePublicarFluxo, useSalvarRascunho } from "@/hooks/flows/useFlows";
import type { ErroDeGrafo, FlowGraph } from "@/lib/flow-engine/graph-schema";
import { configExemploDoTipo } from "@/lib/flow-engine/node-examples";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";
import type { FlowBranch } from "@/lib/flow-engine/types";
import { Question } from "@/lib/ui/icons";

import { ConstrutorComIa } from "./ConstrutorComIa";
import { ICONE_DA_CATEGORIA, ICONE_DO_TIPO } from "./nodeIcons";
import { NoDoFluxo, type DadosDoNo } from "./NoDoFluxo";
import { PainelDoNo } from "./PainelDoNo";

/**
 * O construtor.
 *
 * ⚠️ AS SAÍDAS DE CADA BLOCO SÃO CALCULADAS AQUI COM AS MESMAS DEFINIÇÕES QUE O
 * MOTOR EXECUTA. É o que a regra "nó não fala com o banco" comprou: os nós são
 * TypeScript puro, então rodam no navegador. Uma segunda tabela de saídas no
 * frontend divergiria da do motor, e a divergência apareceria como uma linha
 * desenhada saindo de uma saída que o motor não conhece — desenho certo,
 * roteamento errado, e nada acusando.
 */

const tiposDeNo = { fluxo: NoDoFluxo };

function ramosDoTipo(tipo: string, config: unknown): FlowBranch[] {
  garantirNosRegistrados();
  const def = buscarNo(tipo);
  if (def === undefined) return [];
  const parsed = def.configSchema.safeParse(config);
  // Config incompleta ainda desenha: usa o que der. Recusar aqui deixaria o
  // bloco sem saída nenhuma no quadro justamente enquanto está sendo montado.
  return def.branches((parsed.success ? parsed.data : config) as never);
}

function paraReactFlow(grafo: FlowGraph): { nos: Node[]; arestas: Edge[] } {
  garantirNosRegistrados();
  return {
    nos: grafo.nodes.map((n) => {
      const def = buscarNo(n.type);
      return {
        id: n.id,
        type: "fluxo",
        position: n.position,
        data: {
          rotulo: n.label,
          tipo: n.type,
          categoria: def?.category ?? "logic",
          branches: ramosDoTipo(n.type, n.config),
          config: n.config,
        } satisfies DadosDoNo & { config: unknown },
      };
    }),
    arestas: grafo.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.branch_id,
      label: undefined,
    })),
  };
}

function paraGrafo(nos: Node[], arestas: Edge[]): FlowGraph {
  return {
    nodes: nos.map((n) => {
      const d = n.data as DadosDoNo & { config: unknown };
      return {
        id: n.id,
        type: d.tipo,
        label: d.rotulo,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        config: d.config ?? {},
      };
    }),
    edges: arestas.map((a) => ({
      id: a.id,
      source: a.source,
      target: a.target,
      // O handle É o ramo. Aresta sem handle veio de um bloco de saída única,
      // e nesses o ramo é sempre o pega-tudo.
      branch_id: a.sourceHandle ?? "else",
    })),
  };
}

export function FlowCanvas({ flowId }: { flowId: string }) {
  return (
    <ReactFlowProvider>
      <Quadro flowId={flowId} />
    </ReactFlowProvider>
  );
}

function Quadro({ flowId }: { flowId: string }) {
  const t = useT();
  const { data: fluxo, isLoading } = useFluxo(flowId);
  const { data: paleta } = usePaletaDeNos();
  const salvar = useSalvarRascunho(flowId);
  const publicar = usePublicarFluxo(flowId);

  const [nos, setNos, aoMudarNos] = useNodesState<Node>([]);
  const [arestas, setArestas, aoMudarArestas] = useEdgesState<Edge>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erros, setErros] = useState<ErroDeGrafo[]>([]);
  const [semeadoDe, setSemeadoDe] = useState<string | null>(null);
  // Travado enquanto a IA constrói em streaming: nada de arrastar nó, ligar
  // linha, salvar ou publicar no meio de um grafo que ainda está sendo escrito
  // pedaço a pedaço. Ver ConstrutorComIa.tsx.
  const [bloqueado, setBloqueado] = useState(false);

  // Semear o quadro DURANTE A RENDERIZAÇÃO, e não num `useEffect`.
  //
  // É o padrão que o React documenta para "ajustar estado quando a entrada
  // muda": ele re-renderiza antes de pintar, sem o quadro piscar vazio primeiro.
  // O efeito equivalente causaria uma renderização em cascata — e o próprio lint
  // do repo reprova (`react-hooks/set-state-in-effect`).
  //
  // O guarda é o ID do fluxo, não um booleano: assim, abrir OUTRO fluxo sem
  // desmontar o componente semeia de novo, em vez de mostrar o grafo do anterior.
  if (fluxo !== undefined && semeadoDe !== fluxo.id) {
    setSemeadoDe(fluxo.id);
    const grafo = fluxo.draft_graph ?? fluxo.versao_publicada?.graph ?? null;
    if (grafo !== null) {
      const { nos: n, arestas: a } = paraReactFlow(grafo);
      setNos(n);
      setArestas(a);
    }
  }

  const aoLigar = useCallback(
    (conexao: Connection) => {
      setArestas((atuais) => {
        // Uma saída leva a UM destino. Ligar a segunda linha na mesma saída
        // faria o motor escolher a primeira que achasse — comportamento por
        // acaso de ordem. Substituir é o que a pessoa quis dizer.
        const semAAntiga = atuais.filter(
          (a) => !(a.source === conexao.source && a.sourceHandle === conexao.sourceHandle),
        );
        return addEdge({ ...conexao, id: `${conexao.source}-${conexao.sourceHandle}-${conexao.target}` }, semAAntiga);
      });
    },
    [setArestas],
  );

  const acrescentar = useCallback(
    (no: NoDaPaleta) => {
      const id = `n${Date.now().toString(36)}`;
      const config = configExemploDoTipo(no.type);
      setNos((atuais) => [
        ...atuais,
        {
          id,
          type: "fluxo",
          position: { x: 80 + (atuais.length % 4) * 260, y: 80 + Math.floor(atuais.length / 4) * 200 },
          data: {
            rotulo: no.rotulo,
            tipo: no.type,
            categoria: no.category,
            branches: ramosDoTipo(no.type, config),
            config,
          } satisfies DadosDoNo & { config: unknown },
        },
      ]);
      setSelecionado(id);
    },
    [setNos],
  );

  const noSelecionado = useMemo(
    () => nos.find((n) => n.id === selecionado) ?? null,
    [nos, selecionado],
  );

  /**
   * O ÚNICO caminho que tira bloco do quadro. O botão do painel e a tecla do
   * teclado convergem aqui — ver `onBeforeDelete` lá embaixo. Duas remoções
   * paralelas (a nossa e a do @xyflow) precisariam ser mantidas iguais para
   * sempre, e a primeira divergência apareceria como aresta órfã: desenho
   * certo, roteamento errado, nada acusando.
   */
  const removerNos = useCallback(
    (ids: readonly string[]) => {
      const alvo = new Set(ids);
      setNos((atuais) => atuais.filter((n) => !alvo.has(n.id)));
      setArestas((atuais) => atuais.filter((e) => !alvo.has(e.source) && !alvo.has(e.target)));
      setSelecionado((atual) => (atual !== null && alvo.has(atual) ? null : atual));
    },
    [setNos, setArestas],
  );

  const [aConfirmar, setAConfirmar] = useState<string[] | null>(null);

  const pedirParaApagar = useCallback(
    (ids: readonly string[]) => {
      // O bloco de início É apagável. O que ele ganha é um aviso, porque a
      // consequência é DIFERIDA: o quadro continua funcionando, o rascunho
      // continua salvando, e a recusa só aparece na publicação
      // (`validate-publish.ts`, código `sem_gatilho`). Sem o aviso, a pessoa
      // descobre o problema minutos depois, longe da ação que o causou.
      const temInicio = nos.some(
        (n) => ids.includes(n.id) && (n.data as DadosDoNo).categoria === "trigger",
      );
      if (temInicio) setAConfirmar([...ids]);
      else removerNos(ids);
    },
    [nos, removerNos],
  );

  const atualizarNo = useCallback(
    (id: string, patch: Partial<DadosDoNo & { config: Record<string, unknown> }>) => {
      setNos((atuais) =>
        atuais.map((n) => {
          if (n.id !== id) return n;
          const d = n.data as DadosDoNo & { config: Record<string, unknown> };
          const novaConfig = patch.config ?? d.config;
          return {
            ...n,
            data: {
              ...d,
              ...patch,
              config: novaConfig,
              // As saídas são recalculadas a CADA mudança de config: acrescentar
              // uma condição no painel tem de fazer o handle aparecer no quadro
              // no mesmo instante, senão não há onde ligar a linha nova.
              branches: ramosDoTipo(d.tipo, novaConfig),
            },
          };
        }),
      );
    },
    [setNos],
  );

  /**
   * O quadro sem bloco nenhum não é rascunho — é quadro em branco, e o schema
   * recusa (`graph-schema.ts`, `nodes` é `.min(1)`). O 400 que ele produz diz
   * "Dados inválidos.", uma frase sobre o CORPO DO PEDIDO para um problema que
   * é sobre o QUADRO. A tela para de emitir um pedido que ela já sabe inválido,
   * e diz o motivo real.
   */
  function quadroVazio(): boolean {
    if (nos.length > 0) return false;
    toast.warning(
      t(
        "O quadro está sem blocos. Ponha ao menos um antes de salvar — o rascunho guardado continua o de antes.",
      ),
    );
    return true;
  }

  async function aoSalvar() {
    if (quadroVazio()) return;
    try {
      await salvar.mutateAsync(paraGrafo(nos, arestas));
      toast.success(t("Rascunho salvo."));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Não consegui salvar."));
    }
  }

  async function aoPublicar() {
    if (quadroVazio()) return;
    setErros([]);
    try {
      await salvar.mutateAsync(paraGrafo(nos, arestas));
      const r = await publicar.mutateAsync();
      toast.success(t("Fluxo publicado. Volte à lista para ligá-lo."));
      if (r.avisos.length > 0) {
        toast.warning(r.avisos[0]!.mensagem);
      }
    } catch (err) {
      // O 422 traz os erros ANCORADOS no bloco. Mostrar só um toast genérico
      // faria a pessoa procurar o problema num quadro de 10 blocos.
      const detalhes = (err as { details?: { erros?: ErroDeGrafo[] } })?.details;
      const lista = detalhes?.erros ?? [];
      setErros(lista);
      toast.error(lista[0]?.mensagem ?? (err instanceof Error ? err.message : t("Não consegui publicar.")));
    }
  }

  const nosComErro = useMemo(() => {
    const porAncora = new Map<string, string[]>();
    for (const e of erros) {
      porAncora.set(e.ancora, [...(porAncora.get(e.ancora) ?? []), e.mensagem]);
    }
    return nos.map((n) => ({
      ...n,
      data: { ...(n.data as DadosDoNo), erros: porAncora.get(n.id) ?? [] },
    }));
  }, [nos, erros]);

  if (isLoading) return <Skeleton className="m-6 h-full" />;

  return (
    // `relative`: é contra ESTE elemento que o overlay do ConstrutorComIa se
    // posiciona (`absolute inset-0`), mesmo ele sendo renderizado lá dentro do
    // <header> — CSS absolute ancora no ancestral posicionado mais próximo,
    // não no pai imediato do DOM. Cobre cabeçalho + paleta + canvas juntos:
    // os botões do cabeçalho já ficam `disabled` durante a construção, então
    // cobri-los também é consistente com "não dá para mexer em nada".
    <div className="relative flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/flows">{t("Voltar")}</Link>
        </Button>
        <h1 className="text-sm font-medium">{fluxo?.name ?? ""}</h1>
        {fluxo?.status === "active" && <Badge>{t("Ligado")}</Badge>}
        {fluxo?.active_version_id === null && (
          <Badge variant="secondary">{t("Nunca publicado")}</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <ConstrutorComIa
            flowId={flowId}
            onAtualizarCanvas={({ nos: n, arestas: a }) => {
              setNos(n);
              setArestas(a);
            }}
            grafoAntesDeGerar={() => ({ nos, arestas })}
            onMudarBloqueio={setBloqueado}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={aoSalvar}
            disabled={salvar.isPending || bloqueado}
            data-testid="salvar-rascunho"
          >
            {t("Salvar rascunho")}
          </Button>
          <Button
            size="sm"
            onClick={aoPublicar}
            disabled={publicar.isPending || bloqueado}
            data-testid="publicar-fluxo"
          >
            {t("Publicar")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-56 shrink-0 flex-col overflow-y-auto border-r p-3"
          data-testid="paleta"
          aria-disabled={bloqueado}
        >
          {(paleta?.categorias ?? []).map((cat) => (
            <div key={cat.id} className="mb-4">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(cat.rotulo)}
              </p>
              <ul className="flex flex-col gap-1">
                {(paleta?.nos ?? [])
                  .filter((n) => n.category === cat.id)
                  .map((n) => {
                    const Icone = ICONE_DO_TIPO[n.type] ?? ICONE_DA_CATEGORIA[n.category] ?? Question;
                    return (
                      <li key={n.type}>
                        <button
                          type="button"
                          onClick={() => acrescentar(n)}
                          disabled={bloqueado}
                          title={t(n.descricao)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                          data-testid={`paleta-${n.type}`}
                        >
                          <Icone size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{t(n.rotulo)}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </aside>

        <div className="min-w-0 flex-1" data-testid="quadro">
          <ReactFlow
            nodes={nosComErro}
            edges={arestas}
            onNodesChange={bloqueado ? undefined : aoMudarNos}
            onEdgesChange={bloqueado ? undefined : aoMudarArestas}
            onConnect={bloqueado ? undefined : aoLigar}
            onNodeClick={bloqueado ? undefined : (_, n) => setSelecionado(n.id)}
            onPaneClick={bloqueado ? undefined : () => setSelecionado(null)}
            nodeTypes={tiposDeNo}
            nodesDraggable={!bloqueado}
            nodesConnectable={!bloqueado}
            elementsSelectable={!bloqueado}
            // `Delete` é a tecla que a pessoa aperta; `Backspace` é o default do
            // @xyflow e fica por compatibilidade. Sem esta prop só o Backspace
            // valia, e quem apertava Delete concluía que o bloco não sai.
            //
            // Digitar no painel NÃO apaga bloco: o lib lê a tecla com
            // `actInsideInputWithModifier: false` e a descarta quando o alvo é
            // input ou textarea.
            //
            // `null` enquanto a IA constrói: ali `onNodesChange` é `undefined`,
            // e uma remoção que o lib emite e ninguém aplica é pior que botão
            // desabilitado — é tecla que não faz nada, sem dizer por quê.
            deleteKeyCode={bloqueado ? null : ["Delete", "Backspace"]}
            onBeforeDelete={async ({ nodes: aRemover }) => {
              // Aresta sozinha segue pelo caminho do lib. Bloco, não: quem
              // remove bloco é `removerNos`, SEMPRE, então este caminho VETA o
              // do lib em vez de correr ao lado dele.
              if (aRemover.length === 0) return true;
              pedirParaApagar(aRemover.map((n) => n.id));
              return false;
            }}
            panOnDrag={!bloqueado}
            zoomOnScroll={!bloqueado}
            fitView
            // Sem MiniMap e com a atribuição escondida: o CSS default do
            // @xyflow/react pinta os dois com fundo claro
            // (var(--xy-minimap-background-color-default) e
            // --xy-attribution-background-color-default), e este repo não tem
            // override de tema escuro para nenhuma variável --xy-* — apareciam
            // como um retângulo claro sólido no canto inferior direito, sobre
            // o canvas escuro. O construtor irmão (follow-up,
            // app/app/ai/followups/[id]/_components/FlowCanvas.tsx) já evita o
            // MiniMap de propósito; aqui alinha ao mesmo precedente.
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {noSelecionado !== null && (
          <PainelDoNo
            tipo={(noSelecionado.data as DadosDoNo).tipo}
            rotulo={(noSelecionado.data as DadosDoNo).rotulo}
            config={((noSelecionado.data as { config?: Record<string, unknown> }).config ?? {})}
            aoMudarRotulo={(rotulo) => atualizarNo(noSelecionado.id, { rotulo })}
            aoMudarConfig={(config) => atualizarNo(noSelecionado.id, { config })}
            aoApagar={() => pedirParaApagar([noSelecionado.id])}
          />
        )}
      </div>

      <AlertDialog
        open={aConfirmar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAConfirmar(null);
        }}
      >
        <AlertDialogContent data-testid="confirmar-remover-inicio">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remover o bloco de início?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Sem um bloco de início o fluxo não pode ser publicado — não há o que o faça começar. O rascunho continua podendo ser salvo, e você pega outro bloco de início na paleta, em Começo.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancelar-remocao">{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirmar-remocao"
              onClick={() => {
                if (aConfirmar !== null) removerNos(aConfirmar);
                setAConfirmar(null);
              }}
            >
              {t("Remover")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

