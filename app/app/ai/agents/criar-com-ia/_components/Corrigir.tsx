"use client";
/**
 * "Corrigir existente" no assistente de agentes.
 *
 *   relatar → diagnóstico (causas + perguntas) → proposta (antes × depois,
 *   uma chave por mudança) → testar (opcional, custa tokens) → rascunho.
 *
 * Nada é gravado antes de "Salvar como rascunho", e o rascunho não vai ao ar:
 * quem publica é a pessoa, no editor. As rotas estão em
 * `app/api/v1/ai/agents/[id]/correcao/`.
 */
import Link from "next/link";
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Campo, Grupo, Linha } from "@/components/ajustes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { MapaDePacotes } from "@/lib/ai/agents/construtor/capacidades";
import type { Achado } from "@/lib/ai/agents/construtor/verificacao";
import type { Diagnostico, Proposta } from "@/lib/ai/agents/correcao/esquemas";
import { versaoCorrigida } from "@/lib/ai/agents/correcao/montar";
import type { VersionInput } from "@/lib/ai/agents/validation";
import { ArrowCounterClockwise, Sparkle } from "@/lib/ui/icons";

import { Bolha, CartaoDeOpcao, Pensando } from "@/app/app/flows/[id]/_components/ia/Pecas";

import { BotaoDeAnexar, ListaDeAnexos, type AnexoDaTela } from "./Anexos";
import { DiffDaCorrecao, propostaMarcada, tudoMarcado, type Marcas } from "./DiffDaCorrecao";
import { Aviso } from "./Revisao";

export interface AgenteParaCorrigir {
  id: string;
  nome: string;
}

type Etapa = "relatar" | "diagnosticando" | "diagnostico" | "propondo" | "proposta" | "aplicando" | "pronto";
type Fala = { papel: "usuario" | "ia"; texto: string };

interface BaseDaCorrecao {
  id: string;
  version_number: number;
  partiu_do_rascunho: boolean;
}

interface RespostaDoDiagnostico {
  data: { diagnostico: Diagnostico; base: BaseDaCorrecao };
}

interface RespostaDaProposta {
  data: {
    proposta: Proposta;
    verificacao: Achado[];
    base: BaseDaCorrecao & { versao: VersionInput | null };
    materiais_ligados: Array<{ id: string; nome: string }>;
  };
}

interface RespostaDaAplicacao {
  data: {
    version_id: string;
    version_number: number;
    atualizou_rascunho: boolean;
    materiais: Array<{ id: string; nome: string }>;
    materiais_com_falha: Array<{ nome: string; motivo: string }>;
  };
}

interface RelatorioDoEnsaio {
  mensagens: Array<{ texto: string }>;
  erro: string | null;
  adiamento: { motivo: string } | null;
}

interface Conversa {
  id: string;
  contato: string | null;
  ultima_mensagem_em: string | null;
}

const TEMPO = { timeoutMs: 180_000, semRepetir: true } as const;
const PULOU = "(sem resposta — decida pelo mais seguro)";

const ROTULO_DO_ONDE: Record<string, string> = {
  prompt: "Prompt",
  materiais: "Materiais",
  capacidades: "Capacidades",
  frases_de_passagem: "Frases de passagem",
  configuracao: "Configuração",
  fora_do_agente: "Fora do agente",
};

export function CorrigirAgente({
  agentes,
  agenteInicial,
  mapa,
}: {
  agentes: AgenteParaCorrigir[];
  agenteInicial?: string;
  mapa: MapaDePacotes;
}) {
  const t = useT();
  const [etapa, setEtapa] = React.useState<Etapa>("relatar");
  const [agenteId, setAgenteId] = React.useState(
    agenteInicial && agentes.some((a) => a.id === agenteInicial) ? agenteInicial : (agentes[0]?.id ?? ""),
  );
  const [problema, setProblema] = React.useState("");
  const [conversas, setConversas] = React.useState<Conversa[] | null>(null);
  const [conversaId, setConversaId] = React.useState("");
  const [anexos, setAnexos] = React.useState<AnexoDaTela[]>([]);
  const [falhasDeAnexo, setFalhasDeAnexo] = React.useState<string[]>([]);
  const [historico, setHistorico] = React.useState<Fala[]>([]);
  const [diagnostico, setDiagnostico] = React.useState<Diagnostico | null>(null);
  const [respostas, setRespostas] = React.useState<string[]>([]);
  const [base, setBase] = React.useState<(BaseDaCorrecao & { versao?: VersionInput | null }) | null>(null);
  const [proposta, setProposta] = React.useState<Proposta | null>(null);
  const [marcas, setMarcas] = React.useState<Marcas | null>(null);
  const [verificacao, setVerificacao] = React.useState<Achado[]>([]);
  const [materiaisLigados, setMateriaisLigados] = React.useState<Array<{ id: string; nome: string }>>([]);
  const [mensagemDeTeste, setMensagemDeTeste] = React.useState("");
  const [teste, setTeste] = React.useState<{ antes: RelatorioDoEnsaio; depois: RelatorioDoEnsaio } | null>(null);
  const [testando, setTestando] = React.useState(false);
  const [resultado, setResultado] = React.useState<RespostaDaAplicacao["data"] | null>(null);

  const agente = agentes.find((a) => a.id === agenteId) ?? null;
  const anexosLidos = anexos.filter((a) => a.ler).map(({ nome, texto }) => ({ nome, texto }));
  const ocupado = etapa === "diagnosticando" || etapa === "propondo" || etapa === "aplicando" || testando;

  // As conversas em que o agente atuou, para apontar "foi nesta".
  React.useEffect(() => {
    if (!agenteId) return;
    let vivo = true;
    apiClient
      .get<{ data: Conversa[] }>(`/api/v1/ai/agents/${agenteId}/correcao/conversas`)
      .then((r) => vivo && setConversas(r.data))
      .catch(() => vivo && setConversas([]));
    return () => {
      vivo = false;
    };
  }, [agenteId]);

  function recomecar() {
    setEtapa("relatar");
    setHistorico([]);
    setDiagnostico(null);
    setRespostas([]);
    setBase(null);
    setProposta(null);
    setMarcas(null);
    setVerificacao([]);
    setTeste(null);
    setResultado(null);
  }

  const corpoComum = () => ({
    problema,
    anexos: anexosLidos,
    ...(conversaId ? { conversation_id: conversaId } : {}),
  });

  async function diagnosticar() {
    setEtapa("diagnosticando");
    try {
      const r = await apiClient.post<RespostaDoDiagnostico>(
        `/api/v1/ai/agents/${agenteId}/correcao/diagnosticar`,
        { ...corpoComum(), historico },
        TEMPO,
      );
      setDiagnostico(r.data.diagnostico);
      setRespostas(r.data.diagnostico.perguntas.map(() => ""));
      setBase(r.data.base);
      setEtapa("diagnostico");
    } catch (err) {
      showApiError(err);
      setEtapa("relatar");
    }
  }

  async function propor() {
    if (!diagnostico) return;
    const falas: Fala[] = diagnostico.perguntas.flatMap((p, i) => [
      { papel: "ia" as const, texto: p.pergunta },
      { papel: "usuario" as const, texto: respostas[i]?.trim() || PULOU },
    ]);
    const hist = [...historico, ...falas];
    setEtapa("propondo");
    try {
      const r = await apiClient.post<RespostaDaProposta>(
        `/api/v1/ai/agents/${agenteId}/correcao/propor`,
        { ...corpoComum(), historico: hist, diagnostico: { resumo: diagnostico.resumo, hipoteses: diagnostico.hipoteses } },
        TEMPO,
      );
      setHistorico(hist);
      setProposta(r.data.proposta);
      setMarcas(tudoMarcado(r.data.proposta));
      setVerificacao(r.data.verificacao);
      setBase(r.data.base);
      setMateriaisLigados(r.data.materiais_ligados);
      setMensagemDeTeste(r.data.proposta.mensagem_de_teste);
      setTeste(null);
      setEtapa("proposta");
    } catch (err) {
      showApiError(err);
      setEtapa("diagnostico");
    }
  }

  const efetiva = proposta && marcas ? propostaMarcada(proposta, marcas) : null;

  async function testar() {
    if (!efetiva || !marcas || !base?.versao || !mensagemDeTeste.trim()) return;
    setTestando(true);
    try {
      const conversa = [{ de: "cliente" as const, texto: mensagemDeTeste.trim() }];
      // Um de cada vez: o ensaio é exclusivo por agente (409 se dois rodam juntos).
      const antes = await apiClient.post<{ data: RelatorioDoEnsaio }>(
        `/api/v1/ai/agents/${agenteId}/ensaio`,
        { versao_id: base.id, conversa },
        TEMPO,
      );
      const depois = await apiClient.post<{ data: RelatorioDoEnsaio }>(
        `/api/v1/ai/agents/${agenteId}/ensaio`,
        { versao: versaoCorrigida(base.versao, efetiva, marcas.prompt, mapa), conversa },
        TEMPO,
      );
      setTeste({ antes: antes.data, depois: depois.data });
    } catch (err) {
      showApiError(err);
    } finally {
      setTestando(false);
    }
  }

  async function aplicar() {
    if (!efetiva || !marcas) return;
    setEtapa("aplicando");
    try {
      const r = await apiClient.post<RespostaDaAplicacao>(
        `/api/v1/ai/agents/${agenteId}/correcao/aplicar`,
        { problema, proposta: efetiva, aceitar_prompt: marcas.prompt },
        TEMPO,
      );
      setResultado(r.data);
      setEtapa("pronto");
    } catch (err) {
      showApiError(err);
      setEtapa("proposta");
    }
  }

  if (agentes.length === 0) {
    return (
      <Aviso>
        {t("Ainda não há agente para corrigir. Crie um primeiro em \"Criar novo\".")}
      </Aviso>
    );
  }

  if (etapa === "pronto" && resultado) {
    return (
      <Grupo titulo={t("Correção salva como rascunho")} testid="correcao-pronto">
        <Linha
          titulo={
            <span className="whitespace-normal">
              {resultado.atualizou_rascunho
                ? `${t("O rascunho v")}${resultado.version_number} ${t("foi atualizado.")}`
                : `${t("Nasceu o rascunho v")}${resultado.version_number}.`}{" "}
              {t("O agente no ar não mudou: teste e publique no editor. A versão anterior fica no histórico para voltar.")}
            </span>
          }
        />
        {resultado.materiais_com_falha.length > 0 && (
          <div className="px-4 py-3">
            <Aviso>
              {`${t("Não consegui criar")}: ${resultado.materiais_com_falha.map((m) => m.nome).join(", ")}`}
            </Aviso>
          </div>
        )}
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <Button asChild data-testid="correcao-abrir-editor">
            <Link href={`/app/ai/agents/${agenteId}?aba=teste`}>{t("Abrir no editor para testar e publicar")}</Link>
          </Button>
          <Button variant="outline" onClick={recomecar}>
            {t("Corrigir outro problema")}
          </Button>
        </div>
      </Grupo>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="correcao">
      {/* ── 1. Relatar ─────────────────────────────────────────────────── */}
      <Grupo titulo={t("O que está errado")}>
        <Campo rotulo={t("Agente")} htmlFor="correcao-agente">
          <select
            id="correcao-agente"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={agenteId}
            onChange={(e) => {
              setAgenteId(e.target.value);
              setConversaId("");
              setConversas(null);
              recomecar();
            }}
            disabled={etapa !== "relatar"}
            data-testid="correcao-agente"
          >
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo={t("Conte o problema")} htmlFor="correcao-problema">
          <Textarea
            id="correcao-problema"
            value={problema}
            onChange={(e) => setProblema(e.target.value)}
            rows={5}
            maxLength={4000}
            disabled={etapa !== "relatar"}
            placeholder={t("Ex.: o agente está dando desconto sem autorização; ele não passa para a equipe quando o cliente reclama; responde com textos enormes.")}
            data-testid="correcao-problema"
          />
        </Campo>
        <Campo rotulo={t("Em que conversa aconteceu? (opcional)")} htmlFor="correcao-conversa">
          <select
            id="correcao-conversa"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={conversaId}
            onChange={(e) => setConversaId(e.target.value)}
            disabled={etapa !== "relatar" || conversas === null}
            data-testid="correcao-conversa"
          >
            <option value="">{conversas === null ? t("Carregando…") : t("Nenhuma em especial")}</option>
            {(conversas ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.contato ?? t("Contato sem nome")}${c.ultima_mensagem_em ? ` · ${new Date(c.ultima_mensagem_em).toLocaleString()}` : ""}`}
              </option>
            ))}
          </select>
        </Campo>
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <BotaoDeAnexar
              desabilitado={etapa !== "relatar"}
              aoAnexar={(novos, falhas) => {
                setAnexos((a) => [...a, ...novos].slice(0, 5));
                setFalhasDeAnexo(falhas);
              }}
            />
            <span className="text-xs text-muted-foreground">
              {t("Um print da conversa em PDF, a tabela de preços certa, a política nova…")}
            </span>
          </div>
          {falhasDeAnexo.length > 0 && <Aviso>{`${t("Não consegui ler")}: ${falhasDeAnexo.join("; ")}`}</Aviso>}
          <ListaDeAnexos anexos={anexos} aoMudar={setAnexos} />
        </div>
        {etapa === "relatar" && (
          <div className="flex justify-end px-4 py-3">
            <Button onClick={() => void diagnosticar()} disabled={problema.trim().length < 10 || !agente} data-testid="correcao-diagnosticar">
              <Sparkle className="mr-1.5 size-4" aria-hidden />
              {t("Analisar o agente")}
            </Button>
          </div>
        )}
      </Grupo>

      {etapa === "diagnosticando" && <Pensando rotulo={t("Lendo o agente, as últimas execuções e a conversa…")} />}

      {/* ── 2. Diagnóstico ─────────────────────────────────────────────── */}
      {diagnostico && etapa !== "relatar" && etapa !== "diagnosticando" && (
        <div className="flex flex-col gap-4" data-testid="correcao-diagnostico">
          <Bolha papel="ia">{diagnostico.resumo}</Bolha>
          {base?.partiu_do_rascunho && (
            <Aviso>
              {`${t("Este agente tem um rascunho ainda não publicado (v")}${base.version_number}${t("). A correção parte dele.")}`}
            </Aviso>
          )}
          {diagnostico.hipoteses.length > 0 && (
            <Grupo titulo={t("Causas prováveis")}>
              {diagnostico.hipoteses.map((h, i) => (
                <Linha
                  key={i}
                  titulo={
                    <span className="flex flex-wrap items-center gap-2 whitespace-normal">
                      <Badge variant="outline">{t(ROTULO_DO_ONDE[h.onde] ?? h.onde)}</Badge>
                      {h.causa}
                    </span>
                  }
                  descricao={h.evidencia ? <span className="whitespace-normal font-mono text-xs">{h.evidencia}</span> : undefined}
                />
              ))}
            </Grupo>
          )}
          {etapa === "diagnostico" &&
            diagnostico.perguntas.map((p, i) => (
              <div key={i} className="flex flex-col gap-2" data-testid="correcao-pergunta">
                <Bolha papel="ia">{p.pergunta}</Bolha>
                {p.opcoes.length > 0 && (
                  <div role="radiogroup" aria-label={p.pergunta} className="flex flex-col gap-1.5">
                    {p.opcoes.map((o, j) => (
                      <CartaoDeOpcao
                        key={o}
                        texto={o}
                        indice={j}
                        selecionado={respostas[i] === o}
                        desabilitado={ocupado}
                        aoEscolher={() => setRespostas((r) => r.map((v, k) => (k === i ? o : v)))}
                        aoNavegar={() => undefined}
                      />
                    ))}
                  </div>
                )}
                <Input
                  value={p.opcoes.includes(respostas[i] ?? "") ? "" : (respostas[i] ?? "")}
                  onChange={(e) => setRespostas((r) => r.map((v, k) => (k === i ? e.target.value : v)))}
                  placeholder={p.opcoes.length > 0 ? t("Ou escreva outra resposta") : t("Sua resposta")}
                  aria-label={p.pergunta}
                />
              </div>
            ))}
          {etapa === "diagnostico" && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={recomecar}>
                <ArrowCounterClockwise className="mr-1.5 size-4" aria-hidden />
                {t("Recomeçar")}
              </Button>
              <Button onClick={() => void propor()} data-testid="correcao-propor">
                {t("Propor a correção")}
              </Button>
            </div>
          )}
        </div>
      )}

      {etapa === "propondo" && <Pensando rotulo={t("Escrevendo a correção…")} />}

      {/* ── 3. Proposta ────────────────────────────────────────────────── */}
      {proposta && marcas && efetiva && (etapa === "proposta" || etapa === "aplicando") && (
        <div className="flex flex-col gap-5">
          <DiffDaCorrecao
            proposta={proposta}
            promptAntes={base?.versao?.system_prompt ?? proposta.system_prompt}
            marcas={marcas}
            aoMudar={(m) => {
              setMarcas(m);
              setTeste(null);
            }}
            materiaisLigados={materiaisLigados}
            verificacao={verificacao}
            desabilitado={ocupado}
          />

          <Grupo
            titulo={t("Testar antes de salvar")}
            rodape={t("Roda o agente de verdade duas vezes (como está × corrigido), sem enviar nada a ninguém. Custa tokens. Materiais novos só entram depois de salvar.")}
          >
            <Campo rotulo={t("Mensagem do cliente")} htmlFor="correcao-mensagem-teste">
              <Textarea
                id="correcao-mensagem-teste"
                value={mensagemDeTeste}
                onChange={(e) => {
                  setMensagemDeTeste(e.target.value);
                  setTeste(null);
                }}
                rows={2}
                maxLength={1000}
                disabled={ocupado}
                data-testid="correcao-mensagem-teste"
              />
            </Campo>
            <div className="flex justify-end px-4 py-3">
              <Button
                variant="outline"
                onClick={() => void testar()}
                disabled={ocupado || !base?.versao || !mensagemDeTeste.trim()}
                data-testid="correcao-testar"
              >
                {testando ? t("Testando…") : t("Testar a correção")}
              </Button>
            </div>
            {!base?.versao && (
              <div className="px-4 pb-3">
                <Aviso>{t("A versão atual tem um campo fora do padrão; o teste fica para o editor depois de salvar.")}</Aviso>
              </div>
            )}
            {teste && (
              <div className="grid gap-3 px-4 pb-3 md:grid-cols-2" data-testid="correcao-resultado-teste">
                {(
                  [
                    [t("Como está hoje"), teste.antes],
                    [t("Com a correção"), teste.depois],
                  ] as const
                ).map(([titulo, r]) => (
                  <div key={titulo} className="flex flex-col gap-2 rounded-md border p-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</span>
                    {r.mensagens.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        {r.erro ?? (r.adiamento ? `${t("Adiado")}: ${r.adiamento.motivo}` : t("Não respondeu nada."))}
                      </span>
                    ) : (
                      r.mensagens.map((m, i) => (
                        <Bolha key={i} papel="ia">
                          {m.texto}
                        </Bolha>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </Grupo>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">
              {t("Vira rascunho: o agente no ar só muda quando você publicar no editor.")}
            </span>
            <Button variant="outline" onClick={recomecar} disabled={ocupado}>
              {t("Descartar")}
            </Button>
            <Button onClick={() => void aplicar()} disabled={ocupado} data-testid="correcao-aplicar">
              {etapa === "aplicando" ? t("Salvando…") : t("Salvar como rascunho")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
