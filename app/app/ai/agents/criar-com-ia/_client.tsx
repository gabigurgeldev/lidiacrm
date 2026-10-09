"use client";
/**
 * "Criar agente com IA" — conta, responde, revisa, cria.
 *
 *   contar     a pessoa cola tudo o que tem sobre o negócio;
 *   perguntas  a IA pergunta só o que falta, em até 3 rodadas;
 *   revisar    prévia editável: nome, prompt, capacidades, materiais, canal;
 *   criar      a única escrita — agente em RASCUNHO + materiais.
 *
 * Nada é gravado antes do último clique (mesma regra do "Criar fluxo com IA").
 * Sem streaming: POST JSON simples, porque SSE travava atrás do proxy da VPS
 * (ver o cabeçalho de `useGeracaoDeFluxo.ts`).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ferramentasDe, type MapaDePacotes } from "@/lib/ai/agents/construtor/capacidades";
import type { MaterialDaPrevia, PerguntaDaEntrevista, PreviaGerada } from "@/lib/ai/agents/construtor/esquemas";
import { PACOTES, type ToolBundle } from "@/lib/mcp/tools/pacotes";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";
import { Sparkle, Trash, Warning } from "@/lib/ui/icons";

import {
  Bolha,
  CartaoDeOpcao,
  PassosDaGeracao,
  Pensando,
  ProgressoDaMontagem,
} from "@/app/app/flows/[id]/_components/ia/Pecas";

type Etapa = "contar" | "perguntas" | "gerando" | "revisar" | "criando" | "pronto";
type Fala = { papel: "usuario" | "ia"; texto: string };

interface Canal {
  id: string;
  rotulo: string;
}

interface RespostaDaEntrevista {
  data:
    | { kind: "perguntar"; perguntas: PerguntaDaEntrevista[]; nicho: string; rodada: number; max_rodadas: number }
    | { kind: "pronto"; resumo: string; nicho: string; rodada: number; max_rodadas: number };
}

interface RespostaDaGeracao {
  data: {
    previa: PreviaGerada;
    pacotes_fora_do_teto: ToolBundle[];
    materiais_falharam: boolean;
  };
}

interface RespostaDaCriacao {
  data: {
    agent_id: string;
    materiais: Array<{ id: string; nome: string }>;
    materiais_com_falha: Array<{ nome: string; motivo: string }>;
    avisos: string[];
    indexacao_habilitada: boolean;
  };
}

const PULOU = "(pulei esta — use um padrão razoável ou trate como lacuna)";
const TEMPO = { timeoutMs: 180_000, semRepetir: true } as const;

export function CriarComIa({ canais, mapa }: { canais: Canal[]; mapa: MapaDePacotes }) {
  const t = useT();
  const router = useRouter();
  const [etapa, setEtapa] = React.useState<Etapa>("contar");
  const [material, setMaterial] = React.useState("");
  const [historico, setHistorico] = React.useState<Fala[]>([]);
  const [rodada, setRodada] = React.useState(1);
  const [nicho, setNicho] = React.useState<string | undefined>();
  const [perguntas, setPerguntas] = React.useState<PerguntaDaEntrevista[]>([]);
  const [respostas, setRespostas] = React.useState<string[]>([]);
  const [resumo, setResumo] = React.useState<string | null>(null);
  const [previa, setPrevia] = React.useState<PreviaGerada | null>(null);
  const [foraDoTeto, setForaDoTeto] = React.useState<ToolBundle[]>([]);
  const [materiaisFalharam, setMateriaisFalharam] = React.useState(false);
  const [canal, setCanal] = React.useState(canais[0]?.id ?? "");
  const [criado, setCriado] = React.useState<RespostaDaCriacao["data"] | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  async function entrevistar(hist: Fala[], r: number) {
    setOcupado(true);
    try {
      const res = await apiClient.post<RespostaDaEntrevista>(
        "/api/v1/ai/agents/construtor/entrevistar",
        { material, historico: hist, rodada: r },
        TEMPO,
      );
      // Só agora a rodada conta: se a chamada falhar, a pessoa reenvia as
      // mesmas respostas sem duplicá-las no histórico nem pular uma rodada.
      setHistorico(hist);
      setRodada(r);
      setNicho(res.data.nicho);
      if (res.data.kind === "perguntar") {
        setPerguntas(res.data.perguntas);
        setRespostas(res.data.perguntas.map(() => ""));
        setEtapa("perguntas");
      } else {
        setResumo(res.data.resumo);
        await gerar(hist);
      }
    } catch (err) {
      showApiError(err);
    } finally {
      setOcupado(false);
    }
  }

  async function gerar(hist: Fala[]) {
    setEtapa("gerando");
    try {
      const res = await apiClient.post<RespostaDaGeracao>(
        "/api/v1/ai/agents/construtor/gerar",
        { material, historico: hist, nicho },
        TEMPO,
      );
      setPrevia(res.data.previa);
      setForaDoTeto(res.data.pacotes_fora_do_teto);
      setMateriaisFalharam(res.data.materiais_falharam);
      setEtapa("revisar");
    } catch (err) {
      showApiError(err);
      // Volta para onde a pessoa estava, com tudo o que já respondeu.
      setEtapa(perguntas.length > 0 ? "perguntas" : "contar");
    }
  }

  function enviarRespostas() {
    const novas: Fala[] = perguntas.flatMap((p, i) => [
      { papel: "ia" as const, texto: p.pergunta },
      { papel: "usuario" as const, texto: respostas[i]?.trim() || PULOU },
    ]);
    void entrevistar([...historico, ...novas], rodada + 1);
  }

  async function criar() {
    if (!previa) return;
    setEtapa("criando");
    try {
      const { lacunas: _lacunas, ...resto } = previa;
      const res = await apiClient.post<RespostaDaCriacao>(
        "/api/v1/ai/agents/construtor/criar",
        { ...resto, channel_session_id: canal },
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

  const passo =
    etapa === "contar" ? "descrever" : etapa === "perguntas" ? "esclarecer" : etapa === "pronto" || etapa === "criando" ? "montar" : "planejar";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5" data-testid="criar-agente-com-ia">
      <PassosDaGeracao
        atual={passo}
        rotulos={{
          descrever: t("Contar"),
          esclarecer: t("Perguntas"),
          planejar: t("Revisar"),
          montar: t("Criar"),
        }}
      />

      {etapa === "contar" && (
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="font-medium">{t("Conte tudo sobre o negócio")}</h2>
            <p className="text-sm text-muted-foreground">
              {t(
                "Cole o que tiver: o que a empresa faz, produtos e preços, horários, formas de pagamento, políticas de troca e cancelamento, dúvidas frequentes, objeções, o jeito de falar com o cliente e quando passar para uma pessoa. Quanto mais, melhor — a IA só pergunta o que faltar.",
              )}
            </p>
          </div>
          <Textarea
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            rows={14}
            maxLength={30_000}
            placeholder={t("Ex.: Somos a Clínica Sorriso, em Curitiba. Atendemos de segunda a sábado…")}
            aria-label={t("Informações do negócio")}
            data-testid="construtor-material"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{material.length.toLocaleString()} / 30.000</span>
            <Button
              onClick={() => void entrevistar([], 1)}
              disabled={ocupado || material.trim().length < 20}
              data-testid="construtor-comecar"
            >
              <Sparkle className="mr-2 size-4" aria-hidden />
              {ocupado ? t("Lendo…") : t("Continuar")}
            </Button>
          </div>
          {ocupado && <Pensando rotulo={t("Lendo o que você contou…")} />}
        </Card>
      )}

      {etapa === "perguntas" && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">{t("Só mais algumas perguntas")}</h2>
            <Badge variant="secondary">{`${t("Rodada")} ${Math.min(rodada, 3)} / 3`}</Badge>
          </div>
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
              onClick={() => void gerar(historico)}
              disabled={ocupado}
              data-testid="construtor-pular-perguntas"
            >
              {t("Pular perguntas e montar agora")}
            </button>
            <Button onClick={enviarRespostas} disabled={ocupado} data-testid="construtor-enviar-respostas">
              {ocupado ? t("Lendo…") : t("Enviar respostas")}
            </Button>
          </div>
          {ocupado && <Pensando rotulo={t("Lendo suas respostas…")} />}
        </Card>
      )}

      {etapa === "gerando" && (
        <Card className="flex flex-col gap-3 p-5">
          {resumo && <Bolha papel="ia">{resumo}</Bolha>}
          <ProgressoDaMontagem rotulo={t("Escrevendo o agente e os materiais de conhecimento… pode levar um minuto.")} />
        </Card>
      )}

      {(etapa === "revisar" || etapa === "criando") && previa && (
        <Revisao
          previa={previa}
          aoMudar={setPrevia}
          mapa={mapa}
          foraDoTeto={foraDoTeto}
          materiaisFalharam={materiaisFalharam}
          canais={canais}
          canal={canal}
          aoMudarCanal={setCanal}
          criando={etapa === "criando"}
          aoCriar={() => void criar()}
        />
      )}

      {etapa === "pronto" && criado && (
        <Card className="flex flex-col gap-3 p-5" data-testid="construtor-pronto">
          <h2 className="font-medium">{t("Agente criado como rascunho")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Ele ainda não responde ninguém. Abra no editor, teste e publique quando estiver do seu jeito.")}
          </p>
          {criado.materiais.length > 0 && (
            <p className="text-sm">{`${t("Materiais de conhecimento criados:")} ${criado.materiais.map((m) => m.nome).join(", ")}`}</p>
          )}
          {criado.materiais_com_falha.length > 0 && (
            <Aviso>
              {`${t("Não consegui criar:")} ${criado.materiais_com_falha.map((m) => `${m.nome} (${m.motivo})`).join("; ")}`}
            </Aviso>
          )}
          {!criado.indexacao_habilitada && (
            <Aviso>
              {t(
                "Os materiais foram salvos, mas só serão consultados depois que houver uma chave de embedding (OpenAI ou OpenRouter) em IA › Credenciais.",
              )}
            </Aviso>
          )}
          {criado.avisos.map((a) => (
            <Aviso key={a}>{a}</Aviso>
          ))}
          <div>
            <Link href={`/app/ai/agents/${criado.agent_id}`}>
              <Button data-testid="construtor-abrir-editor">{t("Abrir no editor")}</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <Warning className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Revisao({
  previa,
  aoMudar,
  mapa,
  foraDoTeto,
  materiaisFalharam,
  canais,
  canal,
  aoMudarCanal,
  criando,
  aoCriar,
}: {
  previa: PreviaGerada;
  aoMudar: (p: PreviaGerada) => void;
  mapa: MapaDePacotes;
  foraDoTeto: ToolBundle[];
  materiaisFalharam: boolean;
  canais: Canal[];
  canal: string;
  aoMudarCanal: (id: string) => void;
  criando: boolean;
  aoCriar: () => void;
}) {
  const t = useT();
  const total = ferramentasDe(previa.pacotes, mapa).size;
  const mudar = (parcial: Partial<PreviaGerada>) => aoMudar({ ...previa, ...parcial });
  const mudarMaterial = (i: number, m: MaterialDaPrevia | null) =>
    mudar({
      materiais: m === null ? previa.materiais.filter((_, k) => k !== i) : previa.materiais.map((x, k) => (k === i ? m : x)),
    });

  const podeCriar =
    !criando && canal !== "" && previa.nome.trim() !== "" && previa.system_prompt.trim().length >= 10 && total <= TETO_TOOLS_POR_AGENTE;

  return (
    <div className="flex flex-col gap-4" data-testid="construtor-revisao">
      {previa.lacunas.length > 0 && (
        <Card className="flex flex-col gap-2 border-amber-500/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Warning className="size-4 text-amber-600" aria-hidden />
            {t("O que ficou em aberto")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("O agente não vai inventar nada disso: quando perguntarem, ele chama uma pessoa. Se quiser, complete no prompt ou nos materiais.")}
          </p>
          <ul className="list-disc pl-5 text-sm">
            {previa.lacunas.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-medium">{t("O agente")}</h3>
        <div className="grid gap-1.5">
          <Label htmlFor="construtor-nome">{t("Nome")}</Label>
          <Input
            id="construtor-nome"
            value={previa.nome}
            maxLength={120}
            onChange={(e) => mudar({ nome: e.target.value })}
            data-testid="construtor-nome"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="construtor-descricao">{t("Descrição para a equipe")}</Label>
          <Input
            id="construtor-descricao"
            value={previa.descricao ?? ""}
            maxLength={2000}
            onChange={(e) => mudar({ descricao: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="construtor-prompt">{t("Instruções (prompt)")}</Label>
          <Textarea
            id="construtor-prompt"
            value={previa.system_prompt}
            rows={18}
            maxLength={20_000}
            onChange={(e) => mudar({ system_prompt: e.target.value })}
            className="font-mono text-xs"
            data-testid="construtor-prompt"
          />
          <span className="text-xs text-muted-foreground">{`${previa.system_prompt.length.toLocaleString()} / 20.000`}</span>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="construtor-handoff">{t("Frases que chamam uma pessoa na hora")}</Label>
          <Input
            id="construtor-handoff"
            value={previa.handoff_keywords.join(", ")}
            onChange={(e) =>
              mudar({
                handoff_keywords: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 20),
              })
            }
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{t("O que ele pode fazer")}</h3>
          <span
            className={total > TETO_TOOLS_POR_AGENTE ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            data-testid="construtor-contagem-ferramentas"
          >
            {`${total} / ${TETO_TOOLS_POR_AGENTE} ${t("ferramentas")}`}
          </span>
        </div>
        {foraDoTeto.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("A IA sugeriu mais capacidades do que cabem num agente; liguei as mais importantes.")}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {PACOTES.map((p) => {
            const ligado = previa.pacotes.includes(p.id);
            const cabe = ligado || ferramentasDe([...previa.pacotes, p.id], mapa).size <= TETO_TOOLS_POR_AGENTE;
            return (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ligado}
                  disabled={!cabe || criando}
                  onChange={() =>
                    mudar({ pacotes: ligado ? previa.pacotes.filter((x) => x !== p.id) : [...previa.pacotes, p.id] })
                  }
                  data-testid={`construtor-pacote-${p.id}`}
                />
                <span>
                  <span className="block font-medium">{t(p.rotulo)}</span>
                  <span className="block text-xs text-muted-foreground">{t(p.explicacao)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-medium">{t("Materiais de conhecimento")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("É o que o agente consulta antes de responder. Ele não sabe nada além do que estiver aqui e no prompt.")}
        </p>
        {materiaisFalharam && (
          <Aviso>{t("A IA não conseguiu escrever os materiais desta vez. Você pode criar o agente assim e cadastrar os materiais depois.")}</Aviso>
        )}
        {previa.materiais.length === 0 && !materiaisFalharam && (
          <p className="text-sm text-muted-foreground">{t("Nenhum material sugerido.")}</p>
        )}
        {previa.materiais.map((m, i) => (
          <MaterialEditavel key={i} material={m} aoMudar={(novo) => mudarMaterial(i, novo)} />
        ))}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-medium">{t("Número de WhatsApp")}</h3>
        {canais.length === 0 ? (
          <Aviso>
            {t("Esta organização ainda não tem um número conectado. Conecte um para criar o agente.")}{" "}
            <Link href="/app/connections" className="underline">
              {t("Conectar WhatsApp")}
            </Link>
          </Aviso>
        ) : (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={canal}
            onChange={(e) => aoMudarCanal(e.target.value)}
            aria-label={t("Número de WhatsApp")}
            data-testid="construtor-canal"
          >
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">
          {t("Ele nasce como rascunho: nada vai para o cliente até você publicar.")}
        </span>
        <Button onClick={aoCriar} disabled={!podeCriar} data-testid="construtor-criar">
          {criando ? t("Criando…") : t("Criar agente")}
        </Button>
      </div>
    </div>
  );
}

function MaterialEditavel({
  material: m,
  aoMudar,
}: {
  material: MaterialDaPrevia;
  aoMudar: (m: MaterialDaPrevia | null) => void;
}) {
  const t = useT();
  const [aberto, setAberto] = React.useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="construtor-material-item">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{m.tipo === "faq" ? t("Perguntas e respostas") : t("Documento")}</Badge>
        <Input
          value={m.nome}
          maxLength={120}
          onChange={(e) => aoMudar({ ...m, nome: e.target.value })}
          aria-label={t("Nome do material")}
          className="h-8"
        />
        <Button variant="ghost" size="icon" onClick={() => aoMudar(null)} aria-label={t("Remover material")}>
          <Trash className="size-4" />
        </Button>
      </div>
      <button
        type="button"
        className="self-start text-xs text-primary hover:underline"
        onClick={() => setAberto((a) => !a)}
      >
        {aberto
          ? t("Esconder conteúdo")
          : m.tipo === "faq"
            ? `${t("Ver e editar")} (${m.itens?.length ?? 0} ${t("perguntas")})`
            : t("Ver e editar")}
      </button>
      {aberto && m.tipo === "documento" && (
        <Textarea
          value={m.texto ?? ""}
          rows={10}
          onChange={(e) => aoMudar({ ...m, texto: e.target.value })}
          aria-label={m.nome}
          className="text-xs"
        />
      )}
      {aberto &&
        m.tipo === "faq" &&
        (m.itens ?? []).map((item, k) => (
          <div key={k} className="grid gap-1 rounded-md bg-muted/40 p-2">
            <div className="flex items-center gap-2">
              <Input
                value={item.pergunta}
                onChange={(e) =>
                  aoMudar({
                    ...m,
                    itens: (m.itens ?? []).map((x, j) => (j === k ? { ...x, pergunta: e.target.value } : x)),
                  })
                }
                aria-label={t("Pergunta")}
                className="h-8 text-xs font-medium"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => aoMudar({ ...m, itens: (m.itens ?? []).filter((_, j) => j !== k) })}
                aria-label={t("Remover pergunta")}
              >
                <Trash className="size-3.5" />
              </Button>
            </div>
            <Textarea
              value={item.resposta}
              rows={2}
              onChange={(e) =>
                aoMudar({
                  ...m,
                  itens: (m.itens ?? []).map((x, j) => (j === k ? { ...x, resposta: e.target.value } : x)),
                })
              }
              aria-label={t("Resposta")}
              className="text-xs"
            />
          </div>
        ))}
    </div>
  );
}
