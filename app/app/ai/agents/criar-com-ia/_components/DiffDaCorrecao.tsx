"use client";
/**
 * A correção proposta pela IA, antes × depois, com um interruptor por mudança.
 *
 * Tudo começa marcado; desmarcar tira a mudança do que será aplicado (e do
 * teste). O prompt aparece como diff linha a linha — o mesmo do histórico de
 * versões (`lib/ui/diff-de-linhas.ts`) — e cada mudança traz o porquê.
 */
import * as React from "react";

import { Grupo, Linha, LinhaInterruptor } from "@/components/ajustes";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";
import type { Achado } from "@/lib/ai/agents/construtor/verificacao";
import type { Proposta } from "@/lib/ai/agents/correcao/esquemas";
import { PACOTES, type ToolBundle } from "@/lib/mcp/tools/pacotes";
import { contarMudancas, diffDeLinhas } from "@/lib/ui/diff-de-linhas";
import { Warning } from "@/lib/ui/icons";

/** O que está marcado. Índices para materiais novos (não têm id), valores para o resto. */
export interface Marcas {
  prompt: boolean;
  materiais_novos: number[];
  materiais_desligar: string[];
  pacotes_ligar: ToolBundle[];
  pacotes_desligar: ToolBundle[];
  frases_de_passagem_adicionar: string[];
  frases_de_passagem_remover: string[];
}

export function tudoMarcado(p: Proposta): Marcas {
  return {
    prompt: true,
    materiais_novos: p.materiais_novos.map((_, i) => i),
    materiais_desligar: p.materiais_desligar.map((m) => m.valor),
    pacotes_ligar: p.pacotes_ligar.map((x) => x.valor),
    pacotes_desligar: p.pacotes_desligar.map((x) => x.valor),
    frases_de_passagem_adicionar: [...p.frases_de_passagem_adicionar],
    frases_de_passagem_remover: [...p.frases_de_passagem_remover],
  };
}

/** A proposta só com o que está marcado — é o que vai para o teste e para o aplicar. */
export function propostaMarcada(p: Proposta, m: Marcas): Proposta {
  return {
    ...p,
    materiais_novos: p.materiais_novos.filter((_, i) => m.materiais_novos.includes(i)),
    materiais_desligar: p.materiais_desligar.filter((x) => m.materiais_desligar.includes(x.valor)),
    pacotes_ligar: p.pacotes_ligar.filter((x) => m.pacotes_ligar.includes(x.valor)),
    pacotes_desligar: p.pacotes_desligar.filter((x) => m.pacotes_desligar.includes(x.valor)),
    frases_de_passagem_adicionar: p.frases_de_passagem_adicionar.filter((f) => m.frases_de_passagem_adicionar.includes(f)),
    frases_de_passagem_remover: p.frases_de_passagem_remover.filter((f) => m.frases_de_passagem_remover.includes(f)),
  };
}

const alternar = <T,>(lista: readonly T[], item: T, ligado: boolean): T[] =>
  ligado ? [...new Set([...lista, item])] : lista.filter((x) => x !== item);

const rotuloDoPacote = (id: ToolBundle) => PACOTES.find((p) => p.id === id)?.rotulo ?? id;

export function DiffDaCorrecao({
  proposta,
  promptAntes,
  marcas,
  aoMudar,
  materiaisLigados,
  verificacao,
  desabilitado,
}: {
  proposta: Proposta;
  promptAntes: string;
  marcas: Marcas;
  aoMudar: (m: Marcas) => void;
  materiaisLigados: ReadonlyArray<{ id: string; nome: string }>;
  verificacao: Achado[];
  desabilitado?: boolean;
}) {
  const t = useT();
  const [verDiff, setVerDiff] = React.useState(true);
  const linhas = React.useMemo(() => diffDeLinhas(promptAntes, proposta.system_prompt), [promptAntes, proposta.system_prompt]);
  const { entraram, sairam } = contarMudancas(linhas);
  const promptMudou = entraram + sairam > 0;
  const nomeDoMaterial = (id: string) => materiaisLigados.find((m) => m.id === id)?.nome ?? id;
  const temFrases = proposta.frases_de_passagem_adicionar.length + proposta.frases_de_passagem_remover.length > 0;
  const temPacotes = proposta.pacotes_ligar.length + proposta.pacotes_desligar.length > 0;
  const temMateriais = proposta.materiais_novos.length + proposta.materiais_desligar.length > 0;

  return (
    <div className="flex flex-col gap-5" data-testid="correcao-diff">
      {proposta.explicacao && <p className="text-sm">{proposta.explicacao}</p>}

      <Grupo
        titulo={t("Instruções do agente")}
        rodape={promptMudou ? `+${entraram} / −${sairam} ${t("linhas")}` : t("A correção não mexe no prompt.")}
      >
        {promptMudou && (
          <LinhaInterruptor
            titulo={t("Aplicar a mudança no prompt")}
            ligado={marcas.prompt}
            aoMudar={(v) => aoMudar({ ...marcas, prompt: v })}
            desabilitado={desabilitado}
            testid="correcao-aceitar-prompt"
          />
        )}
        {proposta.mudancas_no_prompt.map((m, i) => (
          <Linha
            key={i}
            titulo={<span className="whitespace-normal">{m.o_que}</span>}
            descricao={m.por_que ? <span className="whitespace-normal">{m.por_que}</span> : undefined}
          />
        ))}
        {promptMudou && (
          <div className="px-4 py-3">
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setVerDiff((v) => !v)}>
              {verDiff ? t("Esconder antes × depois") : t("Ver antes × depois")}
            </button>
            {verDiff && (
              <pre
                className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 font-mono text-xs leading-relaxed"
                data-testid="correcao-diff-prompt"
              >
                {linhas.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.kind === "add"
                        ? "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200"
                        : l.kind === "del"
                          ? "bg-destructive/10 text-destructive line-through decoration-destructive/40"
                          : "text-muted-foreground"
                    }
                  >
                    {`${l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}${l.text}`}
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}
      </Grupo>

      {temMateriais && (
        <Grupo titulo={t("Materiais")}>
          {proposta.materiais_novos.map((m, i) => (
            <LinhaInterruptor
              key={`novo-${i}`}
              titulo={
                <span className="flex flex-wrap items-center gap-2 whitespace-normal">
                  <Badge variant="secondary">{t("novo")}</Badge>
                  {m.nome}
                </span>
              }
              descricao={
                <span className="whitespace-normal">
                  {m.por_que || (m.tipo === "faq" ? `${m.itens?.length ?? 0} ${t("perguntas")}` : (m.texto ?? "").slice(0, 160))}
                </span>
              }
              ligado={marcas.materiais_novos.includes(i)}
              aoMudar={(v) => aoMudar({ ...marcas, materiais_novos: alternar(marcas.materiais_novos, i, v) })}
              desabilitado={desabilitado}
              testid="correcao-mudanca"
            />
          ))}
          {proposta.materiais_desligar.map((m) => (
            <LinhaInterruptor
              key={`fora-${m.valor}`}
              titulo={
                <span className="flex flex-wrap items-center gap-2 whitespace-normal">
                  <Badge variant="outline">{t("deixa de usar")}</Badge>
                  {nomeDoMaterial(m.valor)}
                </span>
              }
              descricao={m.por_que ? <span className="whitespace-normal">{m.por_que}</span> : undefined}
              ligado={marcas.materiais_desligar.includes(m.valor)}
              aoMudar={(v) => aoMudar({ ...marcas, materiais_desligar: alternar(marcas.materiais_desligar, m.valor, v) })}
              desabilitado={desabilitado}
              testid="correcao-mudanca"
            />
          ))}
        </Grupo>
      )}

      {temPacotes && (
        <Grupo titulo={t("Capacidades")}>
          {proposta.pacotes_ligar.map((p) => (
            <LinhaInterruptor
              key={`liga-${p.valor}`}
              titulo={`${t("Ligar")}: ${t(rotuloDoPacote(p.valor))}`}
              descricao={p.por_que ? <span className="whitespace-normal">{p.por_que}</span> : undefined}
              ligado={marcas.pacotes_ligar.includes(p.valor)}
              aoMudar={(v) => aoMudar({ ...marcas, pacotes_ligar: alternar(marcas.pacotes_ligar, p.valor, v) })}
              desabilitado={desabilitado}
              testid="correcao-mudanca"
            />
          ))}
          {proposta.pacotes_desligar.map((p) => (
            <LinhaInterruptor
              key={`desliga-${p.valor}`}
              titulo={`${t("Desligar")}: ${t(rotuloDoPacote(p.valor))}`}
              descricao={p.por_que ? <span className="whitespace-normal">{p.por_que}</span> : undefined}
              ligado={marcas.pacotes_desligar.includes(p.valor)}
              aoMudar={(v) => aoMudar({ ...marcas, pacotes_desligar: alternar(marcas.pacotes_desligar, p.valor, v) })}
              desabilitado={desabilitado}
              testid="correcao-mudanca"
            />
          ))}
        </Grupo>
      )}

      {temFrases && (
        <Grupo titulo={t("Frases que chamam uma pessoa")}>
          {proposta.frases_de_passagem_adicionar.map((f) => (
            <LinhaInterruptor
              key={`mais-${f}`}
              titulo={`${t("Acrescentar")}: “${f}”`}
              ligado={marcas.frases_de_passagem_adicionar.includes(f)}
              aoMudar={(v) =>
                aoMudar({ ...marcas, frases_de_passagem_adicionar: alternar(marcas.frases_de_passagem_adicionar, f, v) })
              }
              desabilitado={desabilitado}
              testid="correcao-mudanca"
            />
          ))}
          {proposta.frases_de_passagem_remover.map((f) => (
            <LinhaInterruptor
              key={`menos-${f}`}
              titulo={`${t("Tirar")}: “${f}”`}
              ligado={marcas.frases_de_passagem_remover.includes(f)}
              aoMudar={(v) => aoMudar({ ...marcas, frases_de_passagem_remover: alternar(marcas.frases_de_passagem_remover, f, v) })}
              desabilitado={desabilitado}
              testid="correcao-mudanca"
            />
          ))}
        </Grupo>
      )}

      {verificacao.length > 0 && (
        <Grupo titulo={t("Conferência do prompt corrigido")} testid="correcao-verificacao">
          {verificacao.map((a, i) => (
            <Linha
              key={`${a.regra}-${i}`}
              icone={<Warning className={a.nivel === "erro" ? "size-4 text-destructive" : "size-4 text-amber-600"} />}
              titulo={<span className="whitespace-normal">{a.mensagem}</span>}
              descricao={a.trecho ? <span className="font-mono">{a.trecho}</span> : undefined}
            />
          ))}
        </Grupo>
      )}
    </div>
  );
}
