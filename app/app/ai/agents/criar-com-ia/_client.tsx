"use client";
/**
 * "Criar agente com IA" — uma conversa que termina num agente.
 *
 *   contar     a pessoa conta sobre o negócio, anexa arquivos, liga materiais
 *              que já existem;
 *   perguntas  a IA pergunta o que falta (quem encerra é o servidor —
 *              `cobertura.ts`), e a qualquer momento dá para acrescentar algo;
 *   revisar    a prévia aparece ao lado; o que a pessoa escreve no chat vira
 *              ajuste (`construtor/refinar`);
 *   criar      a única escrita — agente em RASCUNHO + materiais.
 *
 * Nada é gravado antes do último clique (mesma regra do "Criar fluxo com IA").
 * Sem streaming: POST JSON simples, porque SSE travava atrás do proxy da VPS
 * (ver o cabeçalho de `useGeracaoDeFluxo.ts`). A conversa fica guardada na aba
 * (`sessionStorage`): recarregar a página não joga fora o que já foi feito.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Grupo } from "@/components/ajustes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { randomId } from "@/lib/random-id";
import { sincronizarAnexosGuardados } from "@/lib/ai/agents/construtor/anexos-guardados";
import type { MapaDePacotes } from "@/lib/ai/agents/construtor/capacidades";
import type { PerguntaDaEntrevista, PreviaGerada } from "@/lib/ai/agents/construtor/esquemas";
import type { ToolBundle } from "@/lib/mcp/tools/pacotes";
import { ArrowCounterClockwise, PaperPlaneTilt, Sparkle } from "@/lib/ui/icons";

import { Bolha, CartaoDeOpcao, Pensando, ProgressoDaMontagem } from "@/app/app/flows/[id]/_components/ia/Pecas";

import {
  BotaoDeAnexar,
  ListaDeAnexos,
  SeletorDeMateriais,
  type AnexoDaTela,
  type MaterialExistente,
} from "./_components/Anexos";
import { Aviso, Revisao, ROTULO_DO_MODO, type Canal } from "./_components/Revisao";

type Etapa = "contar" | "perguntas" | "gerando" | "revisar" | "refinando" | "criando" | "pronto";
type Fala = { papel: "usuario" | "ia"; texto: string };
type ItemDoChat = { id: string; de: "voce" | "ia"; texto: string; anexos?: string[] };

interface RespostaDaEntrevista {
  data:
    | { kind: "perguntar"; perguntas: PerguntaDaEntrevista[]; nicho: string; rodada: number; max_rodadas: number }
    | { kind: "pronto"; resumo: string; nicho: string; rodada: number; max_rodadas: number };
}

interface RespostaDaGeracao {
  data: { previa: PreviaGerada; pacotes_fora_do_teto: ToolBundle[]; materiais_falharam: boolean };
}

interface RespostaDoRefino {
  data: { previa: PreviaGerada; pacotes_fora_do_teto: ToolBundle[]; explicacao: string };
}

interface RespostaDaCriacao {
  data: {
    agent_id: string;
    materiais: Array<{ id: string; nome: string }>;
    materiais_com_falha: Array<{ nome: string; motivo: string }>;
    avisos: string[];
    indexacao_habilitada: boolean;
    coordenador: { ok: true; numero: number; modo: "off" | "shadow" | "active"; criada: boolean } | { ok: false } | null;
  };
}

const PULOU = "(pulei esta — use um padrão razoável ou trate como lacuna)";
const TEMPO = { timeoutMs: 180_000, semRepetir: true } as const;
const CHAVE_DA_SESSAO = "construtor-de-agente:v2";

interface EstadoSalvo {
  etapa: Etapa;
  material: string;
  extras: string[];
  anexos: AnexoDaTela[];
  existentes: string[];
  nomesExistentes: Record<string, string>;
  historico: Fala[];
  rodada: number;
  maxRodadas: number;
  nicho?: string;
  perguntas: PerguntaDaEntrevista[];
  respostas: string[];
  previa: PreviaGerada | null;
  foraDoTeto: ToolBundle[];
  materiaisFalharam: boolean;
  chat: ItemDoChat[];
}

export function CriarComIa({ canais, mapa }: { canais: Canal[]; mapa: MapaDePacotes }) {
  const t = useT();
  const router = useRouter();
  const [etapa, setEtapa] = React.useState<Etapa>("contar");
  const [material, setMaterial] = React.useState("");
  const [extras, setExtras] = React.useState<string[]>([]);
  const [anexos, setAnexos] = React.useState<AnexoDaTela[]>([]);
  const [existentes, setExistentes] = React.useState<string[]>([]);
  const [nomesExistentes, setNomesExistentes] = React.useState<Record<string, string>>({});
  const [historico, setHistorico] = React.useState<Fala[]>([]);
  const [rodada, setRodada] = React.useState(1);
  const [maxRodadas, setMaxRodadas] = React.useState(3);
  const [nicho, setNicho] = React.useState<string | undefined>();
  const [perguntas, setPerguntas] = React.useState<PerguntaDaEntrevista[]>([]);
  const [respostas, setRespostas] = React.useState<string[]>([]);
  const [confirmarBrancos, setConfirmarBrancos] = React.useState(false);
  const [previa, setPrevia] = React.useState<PreviaGerada | null>(null);
  const [foraDoTeto, setForaDoTeto] = React.useState<ToolBundle[]>([]);
  const [materiaisFalharam, setMateriaisFalharam] = React.useState(false);
  const [canal, setCanal] = React.useState(canais[0]?.id ?? "");
  const [criado, setCriado] = React.useState<RespostaDaCriacao["data"] | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [chat, setChat] = React.useState<ItemDoChat[]>([]);
  const [rascunho, setRascunho] = React.useState("");
  const [avisosDeAnexo, setAvisosDeAnexo] = React.useState<string[]>([]);
  const restaurado = React.useRef(false);
  const fim = React.useRef<HTMLDivElement>(null);

  // ── Guardar e restaurar a conversa da aba ──────────────────────────────────
  React.useEffect(() => {
    if (restaurado.current) return;
    restaurado.current = true;
    try {
      const bruto = sessionStorage.getItem(CHAVE_DA_SESSAO);
      if (!bruto) return;
      const s = JSON.parse(bruto) as EstadoSalvo;
      // Etapas de espera não voltam: a chamada que estava no ar morreu com a página.
      const etapaSegura: Etapa =
        s.etapa === "gerando" || s.etapa === "refinando" || s.etapa === "criando"
          ? s.previa
            ? "revisar"
            : s.perguntas.length > 0
              ? "perguntas"
              : "contar"
          : s.etapa === "pronto"
            ? "contar"
            : s.etapa;
      setEtapa(etapaSegura);
      setMaterial(s.material);
      setExtras(s.extras);
      setAnexos(s.anexos);
      setExistentes(s.existentes);
      setNomesExistentes(s.nomesExistentes);
      setHistorico(s.historico);
      setRodada(s.rodada);
      setMaxRodadas(s.maxRodadas);
      setNicho(s.nicho);
      setPerguntas(s.perguntas);
      setRespostas(s.respostas);
      setPrevia(s.previa);
      setForaDoTeto(s.foraDoTeto);
      setMateriaisFalharam(s.materiaisFalharam);
      setChat(s.chat);
    } catch {
      // Sem armazenamento (aba privada, bloqueio): começa do zero, sem quebrar.
    }
  }, []);

  React.useEffect(() => {
    if (!restaurado.current) return;
    try {
      if (etapa === "pronto" || (etapa === "contar" && material === "" && chat.length === 0)) {
        sessionStorage.removeItem(CHAVE_DA_SESSAO);
        return;
      }
      const s: EstadoSalvo = {
        etapa,
        material,
        extras,
        anexos,
        existentes,
        nomesExistentes,
        historico,
        rodada,
        maxRodadas,
        nicho,
        perguntas,
        respostas,
        previa,
        foraDoTeto,
        materiaisFalharam,
        chat,
      };
      sessionStorage.setItem(CHAVE_DA_SESSAO, JSON.stringify(s));
    } catch {
      // Cota ou bloqueio: perder a cópia da aba não pode derrubar a tela.
    }
  }, [etapa, material, extras, anexos, existentes, nomesExistentes, historico, rodada, maxRodadas, nicho, perguntas, respostas, previa, foraDoTeto, materiaisFalharam, chat]);

  React.useEffect(() => {
    fim.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [chat.length, etapa]);

  // ── O que vai ao servidor ──────────────────────────────────────────────────
  const materialParaApi = React.useMemo(
    () => [material.trim(), ...extras.map((e) => `Informação adicional do dono: ${e}`)].join("\n\n").slice(0, 30_000),
    [material, extras],
  );
  const anexosLidos = React.useMemo(
    () => anexos.filter((a) => a.ler).map(({ nome, texto }) => ({ nome, texto })),
    [anexos],
  );
  const fonte = React.useMemo(
    () => [materialParaApi, ...historico.map((f) => f.texto), ...anexosLidos.map((a) => a.texto)].join("\n"),
    [materialParaApi, historico, anexosLidos],
  );

  const dizer = (de: ItemDoChat["de"], texto: string, nomesDeAnexo?: string[]) =>
    setChat((c) => [...c, { id: randomId(), de, texto, ...(nomesDeAnexo?.length ? { anexos: nomesDeAnexo } : {}) }]);

  function mudarAnexos(lista: AnexoDaTela[]) {
    setAnexos(lista);
    if (previa) setPrevia(sincronizarAnexosGuardados(previa, lista));
  }

  // ── Passos ─────────────────────────────────────────────────────────────────
  async function entrevistar(hist: Fala[], r: number, nichoAtual = nicho) {
    setOcupado(true);
    try {
      const res = await apiClient.post<RespostaDaEntrevista>(
        "/api/v1/ai/agents/construtor/entrevistar",
        { material: materialParaApi, historico: hist, rodada: r, anexos: anexosLidos, ...(nichoAtual ? { nicho: nichoAtual } : {}) },
        TEMPO,
      );
      // Só agora a rodada conta: se a chamada falhar, a pessoa reenvia as
      // mesmas respostas sem duplicá-las no histórico nem pular uma rodada.
      setHistorico(hist);
      setRodada(res.data.rodada ?? r);
      setMaxRodadas(res.data.max_rodadas ?? 3);
      setNicho(res.data.nicho);
      setConfirmarBrancos(false);
      if (res.data.kind === "perguntar") {
        setPerguntas(res.data.perguntas);
        setRespostas(res.data.perguntas.map(() => ""));
        setEtapa("perguntas");
      } else {
        setPerguntas([]);
        dizer("ia", res.data.resumo);
        // O nicho vai explícito: o estado só atualiza no próximo render.
        await gerar(hist, res.data.nicho);
      }
    } catch (err) {
      showApiError(err);
    } finally {
      setOcupado(false);
    }
  }

  async function gerar(hist: Fala[], nichoDaRodada: string | undefined = nicho) {
    setEtapa("gerando");
    try {
      const res = await apiClient.post<RespostaDaGeracao>(
        "/api/v1/ai/agents/construtor/gerar",
        { material: materialParaApi, historico: hist, anexos: anexosLidos, ...(nichoDaRodada ? { nicho: nichoDaRodada } : {}) },
        TEMPO,
      );
      setPrevia(sincronizarAnexosGuardados({ ...res.data.previa, fontes_existentes: existentes }, anexos));
      setForaDoTeto(res.data.pacotes_fora_do_teto);
      setMateriaisFalharam(res.data.materiais_falharam);
      setHistorico(hist);
      setPerguntas([]);
      setEtapa("revisar");
      dizer(
        "ia",
        t("Montei o agente. Revise a prévia e, se quiser mudar algo, é só me pedir aqui — por exemplo: \"deixe mais formal\" ou \"acrescente a política de troca\"."),
      );
    } catch (err) {
      showApiError(err);
      setEtapa(perguntas.length > 0 ? "perguntas" : "contar");
    }
  }

  function comecar() {
    dizer(
      "voce",
      material.trim().length > 700 ? `${material.trim().slice(0, 700)}…` : material.trim(),
      anexos.map((a) => a.nome),
    );
    void entrevistar([], 1);
  }

  const emBranco = respostas.filter((r) => r.trim() === "").length;

  /** A rodada na tela, como falas. Em branco vira `PULOU` só quando `comPulos`. */
  function falasDaRodada(comPulos: boolean): Fala[] {
    return perguntas.flatMap((p, i) => {
      const r = respostas[i]?.trim() ?? "";
      if (r === "" && !comPulos) return [];
      return [
        { papel: "ia" as const, texto: p.pergunta },
        { papel: "usuario" as const, texto: r || PULOU },
      ];
    });
  }

  function registrarRodadaNoChat(falas: Fala[]) {
    setChat((c) => [
      ...c,
      ...falas.map((f) => ({
        id: randomId(),
        de: f.papel === "ia" ? ("ia" as const) : ("voce" as const),
        texto: f.texto === PULOU ? t("(pulei esta)") : f.texto,
      })),
    ]);
  }

  function enviarRespostas() {
    // Resposta em branco vira lacuna — o agente passa o assunto para uma
    // pessoa. É escolha válida, mas tem de ser escolha.
    if (emBranco > 0 && !confirmarBrancos) {
      setConfirmarBrancos(true);
      return;
    }
    const falas = falasDaRodada(true);
    registrarRodadaNoChat(falas);
    void entrevistar([...historico, ...falas], rodada + 1);
  }

  function pularPerguntas() {
    // Leva o que já foi respondido nesta rodada.
    const falas = falasDaRodada(false);
    registrarRodadaNoChat(falas);
    void gerar([...historico, ...falas]);
  }

  async function refinar(pedido: string) {
    if (!previa) return;
    dizer("voce", pedido);
    setEtapa("refinando");
    try {
      const { lacunas, ...resto } = previa;
      const res = await apiClient.post<RespostaDoRefino>(
        "/api/v1/ai/agents/construtor/refinar",
        {
          material: materialParaApi,
          historico,
          anexos: anexosLidos,
          ...(nicho ? { nicho } : {}),
          previa: { ...resto, lacunas },
          pedido,
        },
        TEMPO,
      );
      setPrevia(sincronizarAnexosGuardados({ ...res.data.previa, fontes_existentes: existentes }, anexos));
      setForaDoTeto(res.data.pacotes_fora_do_teto);
      dizer("ia", res.data.explicacao || t("Pronto, ajustei a prévia."));
    } catch (err) {
      showApiError(err);
    } finally {
      setEtapa("revisar");
    }
  }

  function enviarRascunho() {
    const texto = rascunho.trim();
    if (texto === "") return;
    setRascunho("");
    if (etapa === "revisar") {
      void refinar(texto);
      return;
    }
    // Antes da prévia, o que a pessoa escreve é mais informação sobre o
    // negócio: entra no material da próxima chamada.
    setExtras((e) => [...e, texto]);
    dizer("voce", texto);
  }

  async function criar() {
    if (!previa) return;
    setEtapa("criando");
    try {
      const { lacunas: _lacunas, ...resto } = sincronizarAnexosGuardados(previa, anexos);
      const res = await apiClient.post<RespostaDaCriacao>(
        "/api/v1/ai/agents/construtor/criar",
        { ...resto, fontes_existentes: existentes, channel_session_id: canal },
        TEMPO,
      );
      setCriado(res.data);
      setEtapa("pronto");
      router.refresh();
    } catch (err) {
      showApiError(err);
      setEtapa("revisar");
    }
  }

  function recomecar() {
    try {
      sessionStorage.removeItem(CHAVE_DA_SESSAO);
    } catch {
      // nada a limpar
    }
    setEtapa("contar");
    setMaterial("");
    setExtras([]);
    setAnexos([]);
    setExistentes([]);
    setHistorico([]);
    setRodada(1);
    setNicho(undefined);
    setPerguntas([]);
    setRespostas([]);
    setPrevia(null);
    setChat([]);
    setCriado(null);
  }

  const comPrevia = previa !== null && (etapa === "revisar" || etapa === "refinando" || etapa === "criando");
  const esperando = ocupado || etapa === "gerando" || etapa === "refinando" || etapa === "criando";
  const existentesComNome = existentes.map((id) => ({ id, name: nomesExistentes[id] ?? id }));

  if (etapa === "pronto" && criado) {
    return <Pronto criado={criado} aoRecomecar={recomecar} />;
  }

  return (
    <div
      className={comPrevia ? "grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" : "mx-auto flex w-full max-w-3xl flex-col"}
      data-testid="criar-agente-com-ia"
    >
      {/* ── A conversa ─────────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-4" aria-label={t("Conversa com o assistente")}>
        {etapa === "contar" ? (
          <Grupo
            titulo={t("Conte sobre o negócio")}
            rodape={t(
              "Cole o que tiver: o que a empresa faz, produtos e preços, horários, formas de pagamento, políticas, dúvidas frequentes, objeções, o jeito de falar e quando passar para uma pessoa. Quanto mais, melhor — a IA só pergunta o que faltar.",
            )}
          >
            <div className="flex flex-col gap-3 px-4 py-3">
              <Textarea
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                rows={12}
                maxLength={30_000}
                placeholder={t("Ex.: Somos a Clínica Sorriso, em Curitiba. Atendemos de segunda a sábado…")}
                aria-label={t("Informações do negócio")}
                data-testid="construtor-material"
              />
              <ListaDeAnexos anexos={anexos} aoMudar={mudarAnexos} />
              {avisosDeAnexo.map((a) => (
                <Aviso key={a}>{a}</Aviso>
              ))}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-start gap-2">
                  <BotaoDeAnexar
                    desabilitado={ocupado}
                    aoAnexar={(novos, falhas) => {
                      mudarAnexos([...anexos, ...novos].slice(0, 5));
                      setAvisosDeAnexo(falhas.map((f) => `${t("Não consegui ler")} ${f}`));
                    }}
                  />
                  <SeletorDeMateriais
                    escolhidos={existentes}
                    aoMudar={(ids, todos) => {
                      setExistentes(ids);
                      setNomesExistentes(Object.fromEntries(todos.map((m: MaterialExistente) => [m.id, m.name])));
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{material.length.toLocaleString()} / 30.000</span>
                  <Button onClick={comecar} disabled={ocupado || material.trim().length < 20} data-testid="construtor-comecar">
                    <Sparkle className="mr-2 size-4" aria-hidden />
                    {ocupado ? t("Lendo…") : t("Começar")}
                  </Button>
                </div>
              </div>
              {ocupado && <Pensando rotulo={t("Lendo o que você contou…")} />}
            </div>
          </Grupo>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">
              {etapa === "perguntas"
                ? `${t("Perguntas")} · ${t("Rodada")} ${Math.min(rodada, maxRodadas)} / ${maxRodadas}`
                : comPrevia
                  ? t("Revisão")
                  : t("Montando")}
            </Badge>
            <Button variant="ghost" size="sm" onClick={recomecar} disabled={esperando} data-testid="construtor-recomecar">
              <ArrowCounterClockwise className="mr-1.5 size-4" aria-hidden />
              {t("Recomeçar")}
            </Button>
          </div>
        )}

        {chat.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="construtor-conversa">
            {chat.map((m) => (
              <div key={m.id} className="flex flex-col gap-1">
                <Bolha papel={m.de === "ia" ? "ia" : "usuario"}>
                  <span className="whitespace-pre-wrap">{m.texto}</span>
                </Bolha>
                {m.anexos && m.anexos.length > 0 && (
                  <span className="self-end text-xs text-muted-foreground">{`📎 ${m.anexos.join(", ")}`}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {etapa === "perguntas" && (
          <div className="flex flex-col gap-4" data-testid="construtor-rodada-atual">
            <span className="sr-only" data-testid="construtor-rodada">{`${t("Rodada")} ${Math.min(rodada, maxRodadas)} / ${maxRodadas}`}</span>
            {perguntas.map((p, i) => (
              <div key={`${rodada}-${i}`} className="flex flex-col gap-2" data-testid="construtor-pergunta">
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
                  disabled={ocupado}
                  data-testid="construtor-resposta"
                />
                {p.sugestao && (
                  <button
                    type="button"
                    className="self-start text-xs text-primary hover:underline"
                    onClick={() => setRespostas((r) => r.map((v, k) => (k === i ? (p.sugestao ?? "") : v)))}
                    disabled={ocupado}
                  >
                    {`${t("Usar sugestão:")} ${p.sugestao}`}
                  </button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={pularPerguntas}
                disabled={ocupado}
                data-testid="construtor-pular-perguntas"
              >
                {t("Pular perguntas e montar agora")}
              </button>
              <Button onClick={enviarRespostas} disabled={ocupado} data-testid="construtor-enviar-respostas">
                {ocupado ? t("Lendo…") : confirmarBrancos && emBranco > 0 ? t("Enviar mesmo assim") : t("Enviar respostas")}
              </Button>
            </div>
            {confirmarBrancos && emBranco > 0 && (
              <Aviso>
                <span data-testid="construtor-confirmar-brancos">
                  {emBranco === 1
                    ? t("1 pergunta ficou sem resposta. Ela vira assunto em aberto: o agente chama uma pessoa quando perguntarem.")
                    : `${emBranco} ${t("perguntas ficaram sem resposta. Elas viram assuntos em aberto: o agente chama uma pessoa quando perguntarem.")}`}
                </span>
              </Aviso>
            )}
            {ocupado && <Pensando rotulo={t("Lendo suas respostas…")} />}
          </div>
        )}

        {etapa === "gerando" && (
          <ProgressoDaMontagem rotulo={t("Escrevendo o agente e os materiais de conhecimento… pode levar um minuto.")} />
        )}
        {etapa === "refinando" && <Pensando rotulo={t("Aplicando o ajuste…")} />}

        {etapa !== "contar" && (
          <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background pt-3" data-testid="construtor-composer">
            {etapa !== "revisar" && etapa !== "refinando" && <ListaDeAnexos anexos={anexos} aoMudar={mudarAnexos} />}
            <div className="flex items-end gap-2">
              <Textarea
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviarRascunho();
                  }
                }}
                rows={2}
                maxLength={4000}
                disabled={esperando}
                placeholder={
                  comPrevia
                    ? t("Peça um ajuste: \"deixe mais formal\", \"ele não pode dar desconto\"…")
                    : t("Quer acrescentar algo sobre o negócio?")
                }
                aria-label={t("Mensagem para o assistente")}
                data-testid="construtor-mensagem"
              />
              <Button
                size="icon"
                onClick={enviarRascunho}
                disabled={esperando || rascunho.trim() === ""}
                aria-label={t("Enviar")}
                data-testid="construtor-enviar-mensagem"
              >
                <PaperPlaneTilt className="size-4" aria-hidden />
              </Button>
            </div>
            {!comPrevia && (
              <div className="flex flex-wrap gap-2">
                <BotaoDeAnexar
                  desabilitado={esperando}
                  aoAnexar={(novos, falhas) => {
                    mudarAnexos([...anexos, ...novos].slice(0, 5));
                    setAvisosDeAnexo(falhas.map((f) => `${t("Não consegui ler")} ${f}`));
                  }}
                />
              </div>
            )}
          </div>
        )}
        <div ref={fim} />
      </section>

      {/* ── A prévia ───────────────────────────────────────────────────── */}
      {comPrevia && previa && (
        <section className="min-w-0" aria-label={t("Prévia do agente")}>
          <Revisao
            previa={previa}
            aoMudar={setPrevia}
            mapa={mapa}
            foraDoTeto={foraDoTeto}
            materiaisFalharam={materiaisFalharam}
            fonte={fonte}
            existentes={existentesComNome}
            canais={canais}
            canal={canal}
            aoMudarCanal={setCanal}
            criando={etapa === "criando"}
            aoCriar={() => void criar()}
          />
          {anexos.length > 0 && (
            <div className="mt-4">
              <ListaDeAnexos anexos={anexos} aoMudar={mudarAnexos} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Pronto({ criado, aoRecomecar }: { criado: RespostaDaCriacao["data"]; aoRecomecar: () => void }) {
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="construtor-pronto">
      <Grupo
        titulo={t("Agente criado como rascunho")}
        rodape={t("Ele ainda não responde ninguém. Abra no editor, teste e publique quando estiver do seu jeito.")}
      >
        <div className="flex flex-col gap-3 px-4 py-3 text-sm">
          {criado.materiais.length > 0 && (
            <p>{`${t("Materiais de conhecimento criados:")} ${criado.materiais.map((m) => m.nome).join(", ")}`}</p>
          )}
          {criado.materiais_com_falha.length > 0 && (
            <Aviso>
              {`${t("Não consegui criar:")} ${criado.materiais_com_falha.map((m) => `${m.nome} (${m.motivo})`).join("; ")}`}
            </Aviso>
          )}
          {!criado.indexacao_habilitada && (
            <Aviso>
              {t(
                "Os materiais foram salvos, mas só serão consultados depois que houver uma chave para o modelo do seu material (veja IA › Provedores).",
              )}
            </Aviso>
          )}
          {criado.coordenador?.ok === true && (
            <p data-testid="construtor-coordenador-resultado">
              {criado.coordenador.criada
                ? t("O coordenador de atendimento foi criado em Observar, com este agente como destino.")
                : `${t("Este agente entrou no coordenador de atendimento")} (#${criado.coordenador.numero} · ${t(
                    ROTULO_DO_MODO[criado.coordenador.modo],
                  )}).`}{" "}
              <Link href="/app/ai/coordenador" className="underline">
                {t("Ver o coordenador")}
              </Link>
            </p>
          )}
          {criado.avisos.map((a) => (
            <Aviso key={a}>{t(a)}</Aviso>
          ))}
        </div>
      </Grupo>
      <div className="flex flex-wrap gap-2">
        <Link href={`/app/ai/agents/${criado.agent_id}`}>
          <Button data-testid="construtor-abrir-editor">{t("Abrir no editor")}</Button>
        </Link>
        <Button variant="outline" onClick={aoRecomecar}>
          {t("Criar outro agente")}
        </Button>
      </div>
    </div>
  );
}
