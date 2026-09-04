"use client";

import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { usePaletaDeNos, type NoDaPaleta } from "@/hooks/flows/useFlowNodes";
import { useFluxo, useFluxos, usePublicarFluxo, useSalvarRascunho } from "@/hooks/flows/useFlows";
import { autoLayout } from "@/lib/flow-engine/ai/auto-layout";
import type { ErroDeGrafo, FlowGraph } from "@/lib/flow-engine/graph-schema";
import { configExemploDoTipo } from "@/lib/flow-engine/node-examples";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";
import type { FlowBranch } from "@/lib/flow-engine/types";
import { Question } from "@/lib/ui/icons";

import { ConstrutorComIa } from "./ConstrutorComIa";
import { ICONE_DA_CATEGORIA, ICONE_DO_TIPO } from "./nodeVisuals";
import { NoDoFluxo, type DadosDoNo } from "./NoDoFluxo";
import { EdgeConfigPanel } from "./EdgeConfigPanel";
import { PainelDoNo } from "./PainelDoNo";
import { decorarArestas, duplicarNo } from "./quadro";

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

/**
 * O tipo MIME do arrasto da paleta para o quadro.
 *
 * Próprio, e não `text/plain`: com `text/plain` qualquer texto solto na tela
 * (uma seleção arrastada de outra aba) chegaria no `onDrop` e viraria uma
 * tentativa de criar bloco de um tipo que não existe. Mesmo padrão e mesmo
 * motivo do construtor irmão (`app/app/ai/followups/[id]/_components/`).
 */
const MIME_DO_ARRASTO = "application/x-flow-node-type";

/** O quadro alinha em grade de 20px. Ver o comentário de `snapGrid` abaixo. */
const GRADE: [number, number] = [20, 20];

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

  // ── o que os seletores do painel precisam saber ──
  //
  // ⚠️ Estas duas listas existem porque os campos correspondentes eram texto
  // livre, e texto livre ali é impossível de acertar: o `encontro` pedia o `id`
  // de um bloco que a tela nunca mostra (a pessoa vê "Reencontro", não `junta`),
  // e o `flow.call` pedia um UUID colado à mão. Os dois publicavam e falhavam
  // depois, com a causa longe de quem montou.
  const blocosDeReencontro = useMemo(
    () =>
      nos
        .filter((n) => (n.data as DadosDoNo).tipo === "logic.merge")
        .map((n) => ({ id: n.id, rotulo: (n.data as DadosDoNo).rotulo })),
    [nos],
  );

  // O fluxo ATUAL sai da lista: um fluxo que chama a si mesmo é recursão que a
  // validação de publicação barra depois — melhor não oferecer.
  const { data: todosOsFluxos } = useFluxos();
  const fluxosChamaveis = useMemo(
    () =>
      (todosOsFluxos ?? [])
        .filter((f) => f.id !== flowId)
        .map((f) => ({
          id: f.id,
          nome: f.name,
          publicado: f.active_version_id !== null,
        })),
    [todosOsFluxos, flowId],
  );
  const [arestas, setArestas, aoMudarArestas] = useEdgesState<Edge>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // A linha selecionada. Exclusiva com o nó: dois painéis abertos ao mesmo
  // tempo brigariam pelos mesmos 320px da direita.
  const [arestaSelecionada, setArestaSelecionada] = useState<string | null>(null);
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

  /**
   * Cria o bloco NUMA POSIÇÃO — a peça que faltava para arrastar da paleta.
   *
   * O `acrescentar` de antes calculava a posição sozinho (`80 + n % 4 * 260`),
   * então não havia como dizer "põe aqui". Quem escolhe a posição agora é quem
   * chama: o clique mantém a grade, o arrasto usa onde a pessoa soltou.
   */
  const acrescentarEm = useCallback(
    (no: NoDaPaleta, posicao: { x: number; y: number }) => {
      const id = `n${Date.now().toString(36)}`;
      const config = configExemploDoTipo(no.type);
      setNos((atuais) => [
        ...atuais,
        {
          id,
          type: "fluxo",
          position: posicao,
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
      setArestaSelecionada(null);
    },
    [setNos],
  );

  /**
   * O clique na paleta continua existindo, e não é redundância com o arrasto.
   *
   * Arrastar não é alcançável por teclado — quem navega por Tab não tem gesto
   * equivalente, e a paleta é a única porta para criar bloco. Manter os dois é
   * o que o construtor irmão já faz.
   */
  const acrescentar = useCallback(
    (no: NoDaPaleta) => {
      const n = nos.length;
      acrescentarEm(no, { x: 80 + (n % 4) * 260, y: 80 + Math.floor(n / 4) * 200 });
    },
    [acrescentarEm, nos.length],
  );

  const { screenToFlowPosition } = useReactFlow();

  const aoArrastarPorCima = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const aoSoltar = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const tipo = e.dataTransfer.getData(MIME_DO_ARRASTO);
      if (tipo === "") return;
      const no = (paleta?.nos ?? []).find((x) => x.type === tipo);
      // Tipo que a paleta não conhece não vira bloco: seria um cartão sem
      // rótulo, sem categoria e sem saídas, e o quadro não teria como desenhá-lo.
      if (no === undefined) return;
      acrescentarEm(no, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [acrescentarEm, paleta?.nos, screenToFlowPosition],
  );

  /** Ver `duplicarNo` em `quadro.ts` — inclusive o que NÃO é copiado, e por quê. */
  const duplicar = useCallback(
    (id: string) => {
      const novoId = `n${Date.now().toString(36)}`;
      const copia = duplicarNo(nos, id, novoId);
      if (copia === null) return;
      setNos((atuais) => [...atuais, copia]);
      setSelecionado(novoId);
      setArestaSelecionada(null);
    },
    [nos, setNos],
  );

  /**
   * ARRUMAR: devolve o quadro à grade, de cima para baixo, a partir do gatilho.
   *
   * Reusa o `autoLayout` que a IA de geração já usa — é o mesmo problema (um
   * grafo sem posição que precisa de uma), e duas regras de arrumação
   * diferentes fariam o quadro montado à mão e o gerado ficarem com cara de
   * desenhos de duas mãos. Só as POSIÇÕES mudam; nenhum bloco, ligação ou
   * config é tocado.
   */
  const arrumar = useCallback(() => {
    setNos((atuais) => {
      const posicoes = autoLayout(
        atuais.map((n) => ({ id: n.id, type: (n.data as DadosDoNo).tipo })),
        arestas.map((a) => ({ source: a.source, target: a.target })),
      );
      return atuais.map((n) => ({ ...n, position: posicoes[n.id] ?? n.position }));
    });
  }, [setNos, arestas]);

  const noSelecionado = useMemo(
    () => nos.find((n) => n.id === selecionado) ?? null,
    [nos, selecionado],
  );

  /**
   * Tudo o que o painel da linha precisa, resolvido de uma vez.
   *
   * Mora aqui porque quem é dono do grafo é o quadro: o painel não deve
   * procurar o bloco de origem numa lista que ele não tem.
   */
  const ligacaoSelecionada = useMemo(() => {
    if (arestaSelecionada === null) return null;
    const aresta = arestas.find((a) => a.id === arestaSelecionada);
    if (aresta === undefined) return null;
    const origem = nos.find((n) => n.id === aresta.source);
    const destino = nos.find((n) => n.id === aresta.target);
    if (origem === undefined || destino === undefined) return null;
    return {
      aresta,
      origem: (origem.data as DadosDoNo).rotulo,
      destino: (destino.data as DadosDoNo).rotulo,
      ramosDaOrigem: (origem.data as DadosDoNo).branches,
      // O handle É o ramo; sem handle, o bloco tem saída única e o ramo é o
      // pega-tudo — a mesma leitura que `paraGrafo` faz ao salvar.
      ramoAtual: aresta.sourceHandle ?? "else",
      ramosOcupados: arestas
        .filter((a) => a.source === aresta.source && a.id !== aresta.id)
        .map((a) => a.sourceHandle ?? "else"),
    };
  }, [arestaSelecionada, arestas, nos]);

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

  async function aoSalvar() {
    try {
      await salvar.mutateAsync(paraGrafo(nos, arestas));
      toast.success(t("Rascunho salvo."));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Não consegui salvar."));
    }
  }

  async function aoPublicar() {
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

  const arestasDesenhadas = useMemo(
    () => decorarArestas(nos, arestas, t),
    [nos, arestas, t],
  );

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
          <Button
            variant="ghost"
            size="sm"
            onClick={arrumar}
            disabled={bloqueado || nos.length === 0}
            data-testid="arrumar-quadro"
          >
            {t("Arrumar")}
          </Button>
          {/* A PORTA da tela de execuções deste fluxo. Fica aqui, e não no menu,
              porque é onde a pessoa está quando quer ver o fluxo rodar — e é o
              que o teste de navegação espera de tela sob `[id]`: alcançada a
              partir da lista, nunca item de menu. */}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/flows/${flowId}/execucoes`} data-testid="ver-execucoes-do-fluxo">
              {t("Ver execuções")}
            </Link>
          </Button>
          <ConstrutorComIa
            flowId={flowId}
            onAtualizarCanvas={({ nos: n, arestas: a }) => {
              setNos(n);
              setArestas(a);
            }}
            grafoAntesDeGerar={() => ({ nos, arestas })}
            // `paraGrafo` e não `{ nos, arestas }`: o ajuste vai ao servidor e
            // precisa da forma do MOTOR, com `config` no lugar de `data`.
            grafoAtual={() => paraGrafo(nos, arestas)}
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
          <p className="mb-2 px-2 text-xs text-muted-foreground">
            {t("Clique para acrescentar, ou arraste até o ponto do quadro.")}
          </p>
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
                          draggable={!bloqueado}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(MIME_DO_ARRASTO, n.type);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted active:cursor-grabbing disabled:pointer-events-none disabled:opacity-40"
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

        <div
          className="min-w-0 flex-1"
          data-testid="quadro"
          onDragOver={aoArrastarPorCima}
          onDrop={bloqueado ? undefined : aoSoltar}
        >
          <ReactFlow
            nodes={nosComErro}
            edges={arestasDesenhadas}
            onNodesChange={bloqueado ? undefined : aoMudarNos}
            onEdgesChange={bloqueado ? undefined : aoMudarArestas}
            onConnect={bloqueado ? undefined : aoLigar}
            onNodeClick={
              bloqueado
                ? undefined
                : (_, n) => {
                    setSelecionado(n.id);
                    setArestaSelecionada(null);
                  }
            }
            onEdgeClick={
              bloqueado
                ? undefined
                : (_, a) => {
                    setArestaSelecionada(a.id);
                    setSelecionado(null);
                  }
            }
            onPaneClick={
              bloqueado
                ? undefined
                : () => {
                    setSelecionado(null);
                    setArestaSelecionada(null);
                  }
            }
            nodeTypes={tiposDeNo}
            nodesDraggable={!bloqueado}
            nodesConnectable={!bloqueado}
            elementsSelectable={!bloqueado}
            panOnDrag={!bloqueado}
            zoomOnScroll={!bloqueado}
            fitView
            // A grade alinha o que é solto no quadro. Sem ela, dois blocos
            // arrastados para "a mesma altura" ficam 3px fora, e as linhas
            // entre eles saem tortas — o quadro parece desalinhado sem que
            // ninguém consiga apontar onde.
            snapToGrid
            snapGrid={GRADE}
            // A atribuição continua escondida; o MiniMap voltou.
            //
            // Ele estava fora porque o CSS default do @xyflow/react pinta o
            // painel com fundo claro (`--xy-minimap-background-color-default`)
            // e este repo não tinha override de tema escuro para nenhuma
            // variável `--xy-*` — aparecia como um retângulo claro sólido sobre
            // o canvas escuro. Isso deixou de ser verdade: `app/globals.css`
            // agora liga as `--xy-*` aos tokens do produto, nos dois temas. O
            // motivo de excluí-lo era o defeito, não o componente — e num
            // quadro de vinte blocos ele é a única forma de saber onde se está.
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={GRADE[0]} />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </div>

        {noSelecionado !== null && (
          <PainelDoNo
            tipo={(noSelecionado.data as DadosDoNo).tipo}
            categoria={(noSelecionado.data as DadosDoNo).categoria}
            rotulo={(noSelecionado.data as DadosDoNo).rotulo}
            config={((noSelecionado.data as { config?: Record<string, unknown> }).config ?? {})}
            aoMudarRotulo={(rotulo) => atualizarNo(noSelecionado.id, { rotulo })}
            aoMudarConfig={(config) => atualizarNo(noSelecionado.id, { config })}
            aoApagar={() => {
              setNos((a) => a.filter((n) => n.id !== noSelecionado.id));
              setArestas((a) =>
                a.filter((e) => e.source !== noSelecionado.id && e.target !== noSelecionado.id),
              );
              setSelecionado(null);
            }}
            aoDuplicar={() => duplicar(noSelecionado.id)}
            podeApagar={(noSelecionado.data as DadosDoNo).categoria !== "trigger"}
            blocosDeReencontro={blocosDeReencontro}
            fluxosChamaveis={fluxosChamaveis}
          />
        )}

        {ligacaoSelecionada !== null && (
          <EdgeConfigPanel
            origem={ligacaoSelecionada.origem}
            destino={ligacaoSelecionada.destino}
            ramosDaOrigem={ligacaoSelecionada.ramosDaOrigem}
            ramoAtual={ligacaoSelecionada.ramoAtual}
            ramosOcupados={ligacaoSelecionada.ramosOcupados}
            aoTrocarRamo={(ramo) => {
              // O id da aresta carrega o handle (`origem-ramo-destino`), então
              // trocar a saída troca o id junto — deixá-lo velho faria duas
              // arestas diferentes colidirem no mesmo id ao ligar de novo.
              const a = ligacaoSelecionada.aresta;
              const novoId = `${a.source}-${ramo}-${a.target}`;
              setArestas((atuais) =>
                atuais.map((x) =>
                  x.id === a.id ? { ...x, id: novoId, sourceHandle: ramo } : x,
                ),
              );
              setArestaSelecionada(novoId);
            }}
            aoApagar={() => {
              setArestas((atuais) => atuais.filter((x) => x.id !== ligacaoSelecionada.aresta.id));
              setArestaSelecionada(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

