"use client";
/**
 * TestPanel — o agente responde DE VERDADE, e nada sai.
 *
 * Testa o que está no FORMULÁRIO, salvo ou não, pelo mesmo turno que atende o
 * WhatsApp (`POST /api/v1/ai/agents/:id/ensaio`, `lib/agent-engine/ensaio`): o
 * mesmo prompt, as mesmas conferências antes de enviar, a mesma divisão em
 * bolhas. Nada é enviado ao cliente e nada fica no CRM; as ações do agente
 * aparecem como simuladas, com o que ele escolheu. O custo de IA é real.
 *
 * O painel antigo rodava outro motor (`/versions/:vid/test`): aprovava texto
 * solto que em produção nunca sai, não passava pelas conferências, e as ações
 * de escrita mexiam no CRM de verdade.
 *
 * A conversa continua: cada resposta do agente entra no histórico, e a próxima
 * fala do cliente ensaia o turno seguinte com tudo o que veio antes.
 */
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { useT } from "@/hooks/i18n/useT";
import {
  aparar,
  conversaDepois,
  formatarCusto,
  lerConferencias,
  lerDesfecho,
  type FalaDoEnsaio,
  type RelatorioDoEnsaio,
  type Tom,
} from "@/lib/ai/agents/leitura-do-ensaio";
import { versionCreateSchema } from "@/lib/ai/agents/validation";

import type { VersaoDoFormulario } from "./AgentForm";

interface Props {
  agent: AgentRow;
  /** A versão que o formulário salvaria agora — `null` até o formulário montar. */
  versao: VersaoDoFormulario | null;
  readOnly?: boolean;
}

const COR_DO_TOM: Record<Tom, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/5",
  atencao: "border-amber-500/40 bg-amber-500/5",
  erro: "border-destructive/50 bg-destructive/5",
};

/** O primeiro problema do formulário, em português, para o teste não falhar calado. */
function problemaDoFormulario(versao: VersaoDoFormulario | null): string | null {
  if (versao === null) return "O formulário ainda está carregando.";
  const r = versionCreateSchema.safeParse(versao);
  if (r.success) return null;
  const campo = r.error.issues[0]?.path.join(".") ?? "";
  if (campo === "channel_session_id") return "Escolha o número de WhatsApp do agente.";
  if (campo === "system_prompt") return "As instruções do agente precisam de pelo menos 10 caracteres.";
  if (campo === "model") return "Escolha o modelo de IA.";
  return `Há um campo inválido no formulário (${campo}).`;
}

export function TestPanel({ agent, versao, readOnly }: Props) {
  const t = useT();
  const [conversa, setConversa] = React.useState<FalaDoEnsaio[]>([]);
  const [rascunho, setRascunho] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [agora, setAgora] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [relatorio, setRelatorio] = React.useState<RelatorioDoEnsaio | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const problema = problemaDoFormulario(versao);
  const bloqueado = pending || readOnly === true || problema !== null;

  async function enviar() {
    const texto = rascunho.trim();
    if (!texto || versao === null || problema !== null) return;
    const nova = aparar([...conversa, { de: "cliente", texto }]);
    setConversa(nova);
    setRascunho("");
    setPending(true);
    setErro(null);
    try {
      const res = await fetch(`/api/v1/ai/agents/${agent.id}/ensaio`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versao,
          conversa: nova,
          ...(nome.trim() ? { nome_do_contato: nome.trim() } : {}),
          ...(agora ? { agora: new Date(agora).toISOString() } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: RelatorioDoEnsaio;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setErro(json.error?.message ?? `${t("O teste falhou")} (HTTP ${res.status}).`);
        return;
      }
      setRelatorio(json.data);
      setConversa(conversaDepois(nova, json.data));
    } catch {
      setErro(t("Sem conexão com o servidor. Tente de novo."));
    } finally {
      setPending(false);
    }
  }

  function recomecar() {
    setConversa([]);
    setRelatorio(null);
    setErro(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="ensaio-do-agente">
      <section className="flex flex-col gap-4">
        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs" data-testid="ensaio-aviso">
          <p className="font-medium">{t("Nada é enviado ao cliente nem gravado no CRM.")}</p>
          <p className="mt-1 text-muted-foreground">
            {t(
              "O teste usa o que está no formulário, mesmo sem salvar, e roda o mesmo atendimento do WhatsApp. As ações do agente aparecem como simuladas. O custo de IA é real.",
            )}
          </p>
        </div>

        {problema !== null ? (
          <p
            className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs"
            data-testid="ensaio-formulario-invalido"
          >
            {t(problema)}
          </p>
        ) : null}

        <div
          className="flex min-h-[220px] flex-col gap-2 rounded-md border border-border/60 bg-background p-3"
          data-testid="ensaio-conversa"
        >
          {conversa.length === 0 ? (
            <p className="m-auto text-sm text-muted-foreground">
              {t("Escreva como se fosse o cliente para ver o que o agente responderia.")}
            </p>
          ) : (
            conversa.map((f, i) =>
              f.de === "cliente" ? (
                <div key={i} className="max-w-[85%] self-start rounded-lg bg-muted px-3 py-2 text-sm">
                  {f.texto}
                </div>
              ) : (
                <div
                  key={i}
                  className="max-w-[85%] self-end rounded-lg bg-emerald-500/10 px-3 py-2 text-sm"
                  data-testid="ensaio-bolha-agente"
                >
                  <p className="whitespace-pre-wrap">{f.texto}</p>
                  <p className="mt-1 text-right text-[10px] text-muted-foreground">{t("não enviada")}</p>
                </div>
              ),
            )
          )}
          {pending ? (
            <p className="self-end text-xs text-muted-foreground" data-testid="ensaio-pensando">
              {t("O agente está pensando…")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ensaio-mensagem">{t("Mensagem do cliente")}</Label>
          <Textarea
            id="ensaio-mensagem"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={t("Oi! Vocês atendem hoje?")}
            rows={3}
            disabled={bloqueado}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void enviar()}
            disabled={bloqueado || !rascunho.trim()}
            data-testid="ensaio-enviar"
          >
            {pending ? t("Testando…") : t("Enviar como cliente")}
          </Button>
          <Button variant="outline" onClick={recomecar} disabled={pending || conversa.length === 0}>
            {t("Recomeçar conversa")}
          </Button>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{t("Mais opções do teste")}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ensaio-nome">{t("Nome do cliente")}</Label>
              <Input
                id="ensaio-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Maria"
                disabled={pending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ensaio-agora">{t("Testar como se fosse")}</Label>
              <Input
                id="ensaio-agora"
                type="datetime-local"
                value={agora}
                onChange={(e) => setAgora(e.target.value)}
                disabled={pending}
              />
              <p className="text-muted-foreground">
                {t("Vazio = agora. Serve para ver o horário de atendimento e a janela de envio.")}
              </p>
            </div>
          </div>
        </details>
      </section>

      <section className="flex flex-col gap-3" data-testid="ensaio-relatorio">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("O que aconteceu")}</p>

        {erro !== null ? (
          <p
            className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm"
            data-testid="ensaio-erro"
          >
            {erro}
          </p>
        ) : null}

        {relatorio === null && erro === null ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum teste ainda.")}</p>
        ) : null}

        {relatorio !== null ? <Relatorio r={relatorio} /> : null}
      </section>
    </div>
  );
}

function Relatorio({ r }: { r: RelatorioDoEnsaio }) {
  const t = useT();
  const desfecho = lerDesfecho(r);
  const tentativas = lerConferencias(r.conferencias);
  const esperaTotal = r.esperasMs.reduce((s, ms) => s + ms, 0);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div
        className={`rounded-md border p-3 ${COR_DO_TOM[desfecho.tom]}`}
        data-testid="ensaio-desfecho"
        data-desfecho={r.desfecho}
      >
        <p className="font-medium">{t(desfecho.titulo)}</p>
        {desfecho.detalhe ? <p className="mt-1 text-xs text-muted-foreground">{t(desfecho.detalhe)}</p> : null}
        {r.adiamento?.ate ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Voltaria a tentar em")} {new Date(r.adiamento.ate).toLocaleString()}
          </p>
        ) : null}
      </div>

      {r.ferramentas.length > 0 ? (
        <Bloco titulo={t("O que o agente tentou fazer")} testid="ensaio-ferramentas">
          <ul className="space-y-2">
            {r.ferramentas.map((f, i) => (
              <li key={i} className="rounded border border-border/60 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{f.ferramenta}</span>
                  {f.simulada ? <Badge variant="outline">{t("simulada")}</Badge> : null}
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground">{t("O que ele escolheu")}</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px]">
                    {JSON.stringify(f.entrada, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </Bloco>
      ) : null}

      {tentativas.length > 0 ? (
        <Bloco titulo={t("Conferências antes de enviar")} testid="teste-verificacoes">
          <ul className="space-y-2">
            {tentativas.map((tentativa) => (
              <li key={tentativa.numero} className="text-xs">
                <details>
                  <summary className="cursor-pointer">
                    {t("Mensagem")} {tentativa.numero}:{" "}
                    {tentativa.barradaPor === null ? (
                      <span className="text-emerald-700 dark:text-emerald-400">{t("passou")}</span>
                    ) : (
                      <span className="text-destructive">
                        {t("barrada por")} {t(tentativa.barradaPor)}
                      </span>
                    )}
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {tentativa.linhas.map((l) => (
                      <li key={l.gate} data-resultado={l.resultado}>
                        {l.resultado === "passou" ? "✓" : l.resultado === "barrou" ? "✗" : "–"} {t(l.rotulo)}
                        {l.resultado === "nao_se_aplica" ? ` (${t("não se aplica")})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </Bloco>
      ) : null}

      {r.estado.etapa || r.estado.proximaAcao || r.estado.resumo || r.estado.notas.length > 0 ? (
        <Bloco titulo={t("O que o agente guardou")} testid="ensaio-estado">
          <dl className="space-y-1 text-xs">
            {r.estado.etapa ? (
              <Par rotulo={t("Etapa do cliente")} valor={r.estado.etapa} />
            ) : null}
            {r.estado.proximaAcao ? <Par rotulo={t("Próxima ação")} valor={r.estado.proximaAcao} /> : null}
            {r.estado.resumo ? <Par rotulo={t("Resumo")} valor={r.estado.resumo} /> : null}
            {r.estado.notas.map((n, i) => (
              <Par key={i} rotulo={t("Anotação")} valor={n} />
            ))}
          </dl>
        </Bloco>
      ) : null}

      {r.avisos.length > 0 ? (
        <Bloco titulo={t("Avisos que iriam para a Central")} testid="ensaio-avisos">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {r.avisos.map((a, i) => (
              <li key={i}>{a.titulo}</li>
            ))}
          </ul>
        </Bloco>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-testid="ensaio-numeros">
        <Celula rotulo={t("Custo de IA")}>{formatarCusto(r.custo)}</Celula>
        <Celula rotulo={t("Chamadas ao modelo")}>{r.custo.chamadas}</Celula>
        <Celula rotulo={t("Tokens (entrada / saída)")}>
          {r.custo.tokensDeEntrada.toLocaleString()} / {r.custo.tokensDeSaida.toLocaleString()}
        </Celula>
        <Celula rotulo={t("Tempo do teste")}>{(r.duracaoMs / 1000).toFixed(1)} s</Celula>
      </div>
      {esperaTotal > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("No WhatsApp, o agente esperaria mais")} {(esperaTotal / 1000).toFixed(1)} s{" "}
          {t("entre as mensagens (ritmo de envio contra banimento).")}
        </p>
      ) : null}
    </div>
  );
}

function Bloco({ titulo, testid, children }: { titulo: string; testid: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 p-3" data-testid={testid}>
      <p className="mb-2 text-xs font-medium">{titulo}</p>
      {children}
    </div>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="inline text-muted-foreground">{rotulo}: </dt>
      <dd className="inline">{valor}</dd>
    </div>
  );
}

function Celula({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border/60 px-2 py-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="font-mono">{children}</p>
    </div>
  );
}
