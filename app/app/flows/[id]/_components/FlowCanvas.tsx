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
import { useFluxo, usePublicarFluxo, useSalvarRascunho } from "@/hooks/flows/useFlows";
import type { ErroDeGrafo, FlowGraph } from "@/lib/flow-engine/graph-schema";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";
import type { FlowBranch } from "@/lib/flow-engine/types";

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
      const config = configInicial(no.type);
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
    <div className="flex h-full flex-col">
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
          <Button variant="outline" size="sm" onClick={aoSalvar} disabled={salvar.isPending} data-testid="salvar-rascunho">
            {t("Salvar rascunho")}
          </Button>
          <Button size="sm" onClick={aoPublicar} disabled={publicar.isPending} data-testid="publicar-fluxo">
            {t("Publicar")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r p-3" data-testid="paleta">
          {(paleta?.categorias ?? []).map((cat) => (
            <div key={cat.id} className="mb-4">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(cat.rotulo)}
              </p>
              <ul className="flex flex-col gap-1">
                {(paleta?.nos ?? [])
                  .filter((n) => n.category === cat.id)
                  .map((n) => (
                    <li key={n.type}>
                      <button
                        type="button"
                        onClick={() => acrescentar(n)}
                        title={t(n.descricao)}
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                        data-testid={`paleta-${n.type}`}
                      >
                        {t(n.rotulo)}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </aside>

        <div className="min-w-0 flex-1" data-testid="quadro">
          <ReactFlow
            nodes={nosComErro}
            edges={arestas}
            onNodesChange={aoMudarNos}
            onEdgesChange={aoMudarArestas}
            onConnect={aoLigar}
            onNodeClick={(_, n) => setSelecionado(n.id)}
            onPaneClick={() => setSelecionado(null)}
            nodeTypes={tiposDeNo}
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {noSelecionado !== null && (
          <PainelDoNo
            tipo={(noSelecionado.data as DadosDoNo).tipo}
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
            podeApagar={(noSelecionado.data as DadosDoNo).categoria !== "trigger"}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Config com que cada bloco NASCE. Não é enfeite: um bloco que nasce com config
 * inválida não desenha as saídas, e a pessoa não tem onde ligar a primeira
 * linha — o quadro parece quebrado no primeiro uso.
 */
function configInicial(tipo: string): Record<string, unknown> {
  switch (tipo) {
    case "logic.if":
      return {
        saidas: [
          {
            id: "s1",
            label: "Score acima de 70",
            quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
          },
        ],
      };
    case "logic.wait":
      return { duracao_ms: 300_000 };
    case "logic.end":
      return { desfecho: "concluido" };
    case "crm.add_tag":
      return { tag: "" };
    case "crm.assign_owner":
      return { user_id: "{{vars.dono_escolhido}}" };
    case "crm.owner_responded":
      return { contar_a_partir_de: "desde_o_inicio_do_fluxo" };
    case "routing.round_robin":
    case "routing.redistribute":
      return { quando_ninguem: "tentar_depois", tentar_de_novo_em_ms: 300_000 };
    case "whatsapp.notify_user":
      return {
        destinatario: { tipo: "dono_do_lead" },
        mensagem: "Novo lead: {{lead.title}}",
      };
    case "notify.internal":
      return { titulo: "", corpo: "", severidade: "warn" };
    default:
      return {};
  }
}
