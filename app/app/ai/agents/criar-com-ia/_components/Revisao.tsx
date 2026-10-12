"use client";
/**
 * A prévia do agente no "Criar com IA" — tudo editável antes do clique de criar.
 *
 * Grupos empilhados (kit de Ajustes), e não abas, de propósito: o que a pessoa
 * precisa conferir — o que ficou em aberto, a conferência do prompt, os
 * materiais — não pode morar numa aba que ela nunca abre.
 */
import Link from "next/link";
import * as React from "react";

import { Campo, Dica, Grupo, Linha, LinhaInterruptor } from "@/components/ajustes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ferramentasDe, type MapaDePacotes } from "@/lib/ai/agents/construtor/capacidades";
import type { CoordenacaoDaPrevia, MaterialDaPrevia, PreviaGerada } from "@/lib/ai/agents/construtor/esquemas";
import { verificarManual, verificarPrompt, type Achado } from "@/lib/ai/agents/construtor/verificacao";
import type { Painel } from "@/lib/coordenador/painel";
import { PACOTES, type ToolBundle } from "@/lib/mcp/tools/pacotes";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";
import { CheckCircle, Trash, Warning } from "@/lib/ui/icons";

export interface Canal {
  id: string;
  rotulo: string;
}

export const ROTULO_DO_MODO: Record<"off" | "shadow" | "active", string> = {
  off: "Desligado",
  shadow: "Observar",
  active: "Ativo",
};

export function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <Warning className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Revisao({
  previa,
  aoMudar,
  mapa,
  foraDoTeto,
  materiaisFalharam,
  fonte,
  existentes,
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
  /** O que o dono contou — a conferência do prompt acusa fato que não está aqui. */
  fonte: string;
  /** Nome dos materiais existentes ligados (para mostrar). */
  existentes: Array<{ id: string; name: string }>;
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

  // Conferência ao vivo: refaz a cada edição do prompt, então a pessoa vê o
  // achado sumir quando corrige. É a mesma função que as rotas usam.
  const verificacao = React.useMemo(
    () => [
      ...verificarPrompt({ prompt: previa.system_prompt, fonte, pacotes: previa.pacotes }),
      ...verificarManual(previa.materiais),
    ],
    [previa.system_prompt, previa.pacotes, previa.materiais, fonte],
  );

  const podeCriar =
    !criando && canal !== "" && previa.nome.trim() !== "" && previa.system_prompt.trim().length >= 10 && total <= TETO_TOOLS_POR_AGENTE;

  return (
    <div className="flex flex-col gap-6" data-testid="construtor-revisao">
      <CartaoDeVerificacao achados={verificacao} />

      {previa.lacunas.length > 0 && (
        <Grupo
          titulo={t("O que ficou em aberto")}
          rodape={t("O agente não vai inventar nada disso: quando perguntarem, ele chama uma pessoa. Se quiser, complete no prompt, nos materiais ou peça no chat.")}
        >
          {previa.lacunas.map((l) => (
            <Linha key={l} icone={<Warning className="size-4 text-amber-600" />} titulo={l} />
          ))}
        </Grupo>
      )}

      <Grupo titulo={t("O agente")}>
        <Campo rotulo={t("Nome")} htmlFor="construtor-nome">
          <Input
            id="construtor-nome"
            value={previa.nome}
            maxLength={120}
            onChange={(e) => mudar({ nome: e.target.value })}
            data-testid="construtor-nome"
          />
        </Campo>
        <Campo rotulo={t("Descrição para a equipe")} htmlFor="construtor-descricao">
          <Input
            id="construtor-descricao"
            value={previa.descricao ?? ""}
            maxLength={2000}
            onChange={(e) => mudar({ descricao: e.target.value })}
          />
        </Campo>
        <Campo rotulo={t("Instruções (prompt)")} htmlFor="construtor-prompt">
          <Textarea
            id="construtor-prompt"
            value={previa.system_prompt}
            rows={18}
            maxLength={20_000}
            onChange={(e) => mudar({ system_prompt: e.target.value })}
            className="font-mono text-xs"
            data-testid="construtor-prompt"
          />
          <Dica texto={`${previa.system_prompt.length.toLocaleString()} / 20.000`} />
        </Campo>
        <Campo rotulo={t("Frases que chamam uma pessoa na hora")} htmlFor="construtor-handoff">
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
        </Campo>
      </Grupo>

      <Grupo
        titulo={t("O que ele pode fazer")}
        rodape={
          foraDoTeto.length > 0
            ? t("A IA sugeriu mais capacidades do que cabem num agente; liguei as mais importantes.")
            : undefined
        }
      >
        <Linha
          titulo={t("Ferramentas ligadas")}
          valor={
            <span
              className={total > TETO_TOOLS_POR_AGENTE ? "text-destructive" : undefined}
              data-testid="construtor-contagem-ferramentas"
            >
              {`${total} / ${TETO_TOOLS_POR_AGENTE}`}
            </span>
          }
        />
        {PACOTES.map((p) => {
          const ligado = previa.pacotes.includes(p.id);
          const cabe = ligado || ferramentasDe([...previa.pacotes, p.id], mapa).size <= TETO_TOOLS_POR_AGENTE;
          return (
            <LinhaInterruptor
              key={p.id}
              titulo={t(p.rotulo)}
              descricao={t(p.explicacao)}
              ligado={ligado}
              desabilitado={!cabe || criando}
              aoMudar={() =>
                mudar({ pacotes: ligado ? previa.pacotes.filter((x) => x !== p.id) : [...previa.pacotes, p.id] })
              }
              testid={`construtor-pacote-${p.id}`}
            />
          );
        })}
      </Grupo>

      <Grupo
        titulo={t("Materiais de conhecimento")}
        rodape={t("É o que o agente consulta antes de responder. Ele não sabe nada além do que estiver aqui e no prompt.")}
      >
        {materiaisFalharam && (
          <div className="px-4 py-3">
            <Aviso>{t("A IA não conseguiu escrever os materiais desta vez. Você pode criar o agente assim e cadastrar os materiais depois.")}</Aviso>
          </div>
        )}
        {previa.materiais.length === 0 && existentes.length === 0 && !materiaisFalharam && (
          <Linha titulo={t("Nenhum material sugerido.")} />
        )}
        {previa.materiais.map((m, i) => (
          <MaterialEditavel key={i} material={m} aoMudar={(novo) => mudarMaterial(i, novo)} />
        ))}
        {existentes.map((f) => (
          <Linha key={f.id} titulo={f.name} descricao={t("Material que já existia — o agente também vai ler.")} valor={t("existente")} />
        ))}
      </Grupo>

      <CartaoDeCoordenacao
        coordenacao={previa.coordenacao}
        aoMudar={(c) => mudar({ coordenacao: c })}
        descricaoPadrao={previa.descricao ?? ""}
      />

      <Grupo titulo={t("Número de WhatsApp")}>
        {canais.length === 0 ? (
          <div className="px-4 py-3">
            <Aviso>
              {t("Esta organização ainda não tem um número conectado. Conecte um para criar o agente.")}{" "}
              <Link href="/app/connections" className="underline">
                {t("Conectar WhatsApp")}
              </Link>
            </Aviso>
          </div>
        ) : (
          <Campo rotulo={t("Número que o agente atende")} htmlFor="construtor-canal">
            <select
              id="construtor-canal"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={canal}
              onChange={(e) => aoMudarCanal(e.target.value)}
              data-testid="construtor-canal"
            >
              {canais.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>
        )}
      </Grupo>

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

function CartaoDeVerificacao({ achados }: { achados: Achado[] }) {
  const t = useT();
  const erros = achados.filter((a) => a.nivel === "erro");
  if (achados.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="construtor-verificacao-ok">
        <CheckCircle className="size-4 text-emerald-600" aria-hidden />
        {t("Conferência do prompt: nada a corrigir.")}
      </p>
    );
  }
  return (
    <Grupo
      titulo={erros.length > 0 ? t("Conferência do prompt: corrija antes de criar") : t("Conferência do prompt: vale olhar")}
      testid="construtor-verificacao"
    >
      {achados.map((a, i) => (
        <Linha
          key={`${a.regra}-${i}`}
          icone={<Warning className={a.nivel === "erro" ? "size-4 text-destructive" : "size-4 text-amber-600"} />}
          titulo={<span className="whitespace-normal">{a.mensagem}</span>}
          descricao={a.trecho ? <span className="font-mono">{a.trecho}</span> : undefined}
        />
      ))}
    </Grupo>
  );
}

const COORDENACAO_VAZIA: CoordenacaoDaPrevia = {
  incluir: true,
  quando_usar: "",
  exemplos: [],
  nao_usar: [],
  fluxos_chamaveis: [],
};

const porLinha = (texto: string) =>
  texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);

/**
 * O agente no coordenador de atendimento. Mostra o estado do coordenador da
 * organização ANTES do clique: "vai nascer em Observar" ou "entra na política
 * em vigor, e o modo não muda" — a pessoa não descobre depois.
 */
function CartaoDeCoordenacao({
  coordenacao,
  aoMudar,
  descricaoPadrao,
}: {
  coordenacao: CoordenacaoDaPrevia | undefined;
  aoMudar: (c: CoordenacaoDaPrevia) => void;
  descricaoPadrao: string;
}) {
  const t = useT();
  const c = coordenacao ?? { ...COORDENACAO_VAZIA, quando_usar: descricaoPadrao };
  const [painel, setPainel] = React.useState<Painel | null>(null);

  React.useEffect(() => {
    let vivo = true;
    apiClient
      .get<{ data: Painel }>("/api/v1/ai/coordenador")
      .then((r) => {
        if (vivo) setPainel(r.data);
      })
      .catch(() => {
        // Sem o estado, o cartão segue útil: só não diz em que modo está.
      });
    return () => {
      vivo = false;
    };
  }, []);

  const fluxosAtivos = (painel?.fluxos ?? []).filter((f) => f.ativo);

  return (
    <Grupo
      titulo={t("Coordenador de atendimento")}
      testid="construtor-coordenacao"
      rodape={
        <>
          {painel === null
            ? t("O coordenador decide quem conduz cada conversa quando há mais de um agente ou fluxo.")
            : painel.versaoAtual === null
              ? t("Ainda não há coordenador: ele será criado em Observar — registra o que faria, sem mudar nada para o cliente.")
              : `${t("O agente entra na política em vigor, e o modo dela não muda:")} ${t(
                  ROTULO_DO_MODO[painel.versaoAtual.modo],
                )}.`}{" "}
          {t("O agente nasce em rascunho e só recebe conversas depois de publicado.")}
        </>
      }
    >
      <LinhaInterruptor
        titulo={t("Incluir este agente no coordenador")}
        ligado={c.incluir}
        aoMudar={(v) => aoMudar({ ...c, incluir: v })}
      />
      {c.incluir && (
        <>
          <Campo rotulo={t("Quando usar")} htmlFor="coord-quando">
            <Textarea
              id="coord-quando"
              rows={2}
              maxLength={600}
              value={c.quando_usar}
              onChange={(e) => aoMudar({ ...c, quando_usar: e.target.value })}
            />
          </Campo>
          <Campo rotulo={t("Exemplos de mensagem (um por linha)")} htmlFor="coord-exemplos">
            <Textarea
              id="coord-exemplos"
              rows={3}
              value={c.exemplos.join("\n")}
              onChange={(e) => aoMudar({ ...c, exemplos: porLinha(e.target.value) })}
            />
          </Campo>
          <Campo rotulo={t("Não usar quando (um por linha)")} htmlFor="coord-nao">
            <Textarea
              id="coord-nao"
              rows={3}
              value={c.nao_usar.join("\n")}
              onChange={(e) => aoMudar({ ...c, nao_usar: porLinha(e.target.value) })}
            />
          </Campo>
          <Campo rotulo={t("Fluxos que este agente pode chamar e voltar")}>
            {fluxosAtivos.length === 0 ? (
              <Dica texto={t("Nenhum fluxo ligado ainda. Quando houver, você pode deixar o agente chamá-los pela tela do coordenador.")} />
            ) : (
              <div className="flex flex-wrap gap-3">
                {fluxosAtivos.map((f) => (
                  <label key={f.id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={c.fluxos_chamaveis.includes(f.id)}
                      onChange={() =>
                        aoMudar({
                          ...c,
                          fluxos_chamaveis: c.fluxos_chamaveis.includes(f.id)
                            ? c.fluxos_chamaveis.filter((x) => x !== f.id)
                            : [...c.fluxos_chamaveis, f.id].slice(0, 10),
                        })
                      }
                    />
                    {f.nome}
                  </label>
                ))}
              </div>
            )}
          </Campo>
        </>
      )}
    </Grupo>
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
    <div className="flex flex-col gap-2 px-4 py-3" data-testid="construtor-material-item">
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
