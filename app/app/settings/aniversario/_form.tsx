"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { personalizarTexto, personalizarValores } from "@/lib/bulk-send/personalizar";
import { lerConteudo } from "@/lib/channels/template-conteudo";
import {
  HORA_MAXIMA,
  HORA_MINIMA,
  MENSAGEM_PADRAO_DE_ANIVERSARIO,
  type AniversarioConfig,
} from "@/lib/schemas/aniversario";

/** O que `/api/v1/bulk-sends/conexoes` devolve — vocabulário de produto, nunca o canal. */
interface Conexao {
  id: string;
  rotulo: string;
  conectada: boolean;
  modo: "freeform" | "template";
  fonte_de_modelos: "oficial" | "parceiro" | null;
}

interface ModeloAprovado {
  name: string;
  language: string;
  status: string;
  components?: unknown[];
  slots?: Array<{ key: string; expects: string; onde: string }>;
}

interface Painel {
  hoje: string;
  proximos: { data: string; contatos: { id: string; nome: string; nascimento: string }[] }[];
  contatos_com_data: number;
  envios: { data_local: string; total: number; bulk_send_id: string | null }[];
}

/** Mesmo mapa do disparo e do bloco de fluxo: a tela recebe o rótulo neutro. */
const ROTA_DA_FONTE: Record<"oficial" | "parceiro", string> = {
  oficial: "/api/v1/channels/templates",
  parceiro: "/api/v1/channels/partner/templates",
};

const NOME_DE_EXEMPLO = "Ana Souza";

function dataCurta(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function AniversarioForm({ initial }: { initial: AniversarioConfig }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<AniversarioConfig>(initial);
  const [salvo, setSalvo] = useState<AniversarioConfig>(initial);
  const [isPending, startTransition] = useTransition();
  const sujo = JSON.stringify(form) !== JSON.stringify(salvo);

  const { data: conexoes } = useQuery({
    queryKey: ["bulk-send-conexoes"],
    queryFn: async () => apiClient.get<{ data: Conexao[] }>("/api/v1/bulk-sends/conexoes"),
    select: (r) => r.data,
  });
  const conexao = (conexoes ?? []).find((c) => c.id === form.canal_id) ?? null;

  const fonte = conexao?.modo === "template" ? conexao.fonte_de_modelos : null;
  const { data: modelos, isLoading: carregandoModelos } = useQuery({
    queryKey: ["modelos-da-conexao", fonte, form.canal_id],
    enabled: fonte !== null && form.canal_id !== null,
    queryFn: async () =>
      apiClient.get<{ data: { templates?: ModeloAprovado[] } }>(`${ROTA_DA_FONTE[fonte!]}?canal_id=${form.canal_id}`),
    select: (r) => (r.data.templates ?? []).filter((m) => m.status?.toUpperCase() === "APPROVED"),
    staleTime: 30_000,
  });
  const modelo =
    (modelos ?? []).find((m) => m.name === form.modelo?.nome && m.language === form.modelo?.idioma) ?? null;
  const conteudoDoModelo = modelo ? lerConteudo(modelo.components) : null;
  const lacunas = modelo?.slots ?? [];

  const { data: painel } = useQuery({
    queryKey: ["aniversario-painel"],
    queryFn: async () => apiClient.get<{ data: Painel }>("/api/v1/settings/aniversario"),
    select: (r) => r.data,
  });

  function escolherConexao(c: Conexao) {
    setForm((f) => ({
      ...f,
      canal_id: c.id,
      modo: c.modo,
      // Modelo é aprovado POR CONTA: o da conexão anterior não existe nesta.
      modelo: c.id === f.canal_id ? f.modelo : null,
      mensagem: f.mensagem.trim() ? f.mensagem : MENSAGEM_PADRAO_DE_ANIVERSARIO,
    }));
  }

  function inserirVariavel(v: string) {
    setForm((f) => ({ ...f, mensagem: `${f.mensagem}${f.mensagem.endsWith(" ") || !f.mensagem ? "" : " "}${v}` }));
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await apiClient.patch("/api/v1/settings/aniversario", form);
        setSalvo(form);
        void qc.invalidateQueries({ queryKey: ["aniversario-painel"] });
        toast.success(form.ativo ? t("Mensagem de aniversário ligada.") : t("Configuração salva."));
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Não consegui salvar."));
      }
    });
  }

  const hoje = painel?.proximos[0];
  const proximos = (painel?.proximos ?? []).slice(1).filter((d) => d.contatos.length > 0);

  return (
    <form onSubmit={salvar} className="flex max-w-3xl flex-col gap-6" data-testid="form-aniversario">
      <Card className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">{t("Enviar parabéns automaticamente")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("Todo dia, no horário escolhido, cada contato que faz aniversário recebe a mensagem abaixo.")}
            </p>
          </div>
          <Switch
            checked={form.ativo}
            onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))}
            aria-label={t("Enviar parabéns automaticamente")}
          />
        </div>

        <div className="flex flex-col gap-2 sm:max-w-xs">
          <Label htmlFor="hora">{t("Horário do envio")}</Label>
          <select
            id="hora"
            value={form.hora}
            onChange={(e) => setForm((f) => ({ ...f, hora: Number(e.target.value) }))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {Array.from({ length: HORA_MAXIMA - HORA_MINIMA + 1 }, (_, i) => HORA_MINIMA + i).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("Horário da empresa. As mensagens saem espaçadas a partir daí, com a proteção anti-banimento da conexão.")}
          </p>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("Por qual WhatsApp enviar")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("QR code aceita texto livre. A API oficial só envia modelo aprovado pela Meta.")}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {(conexoes ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => escolherConexao(c)}
              aria-pressed={form.canal_id === c.id}
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                form.canal_id === c.id ? "border-primary bg-muted/50" : "hover:bg-muted/30"
              }`}
            >
              <span className="font-medium">{c.rotulo}</span>
              <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {c.modo === "template" ? t("API oficial") : t("QR code")}
              </span>
              {!c.conectada && (
                <span className="ml-2 text-xs text-destructive">{t("desconectado — o envio espera reconectar")}</span>
              )}
            </button>
          ))}
          {(conexoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("Nenhuma conexão de WhatsApp. Conecte um número em Conexões primeiro.")}
            </p>
          )}
        </div>
      </Card>

      {conexao?.modo === "freeform" && (
        <Card className="space-y-3 p-4">
          <Label htmlFor="mensagem">{t("Mensagem")}</Label>
          <Textarea
            id="mensagem"
            rows={5}
            value={form.mensagem}
            onChange={(e) => setForm((f) => ({ ...f, mensagem: e.target.value }))}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("Inserir:")}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => inserirVariavel("{{primeiro_nome}}")}>
              {t("Primeiro nome")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => inserirVariavel("{{nome}}")}>
              {t("Nome completo")}
            </Button>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t("Como o cliente recebe")} ({NOME_DE_EXEMPLO})
            </p>
            <p className="max-w-md whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted/60 px-3 py-2 text-sm">
              {personalizarTexto(form.mensagem, NOME_DE_EXEMPLO) || "…"}
            </p>
          </div>
        </Card>
      )}

      {conexao?.modo === "template" && (
        <Card className="space-y-3 p-4">
          <Label htmlFor="modelo">{t("Modelo aprovado")}</Label>
          {carregandoModelos ? (
            <p className="text-sm text-muted-foreground">{t("Carregando os modelos…")}</p>
          ) : (modelos ?? []).length === 0 ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              {t(
                "Nenhum modelo aprovado nesta conexão. Crie um modelo de aniversário em Conexões, espere a Meta aprovar e volte aqui.",
              )}
            </p>
          ) : (
            <select
              id="modelo"
              value={form.modelo ? `${form.modelo.nome}|${form.modelo.idioma}` : ""}
              onChange={(e) => {
                const [nome, idioma] = e.target.value.split("|");
                setForm((f) => ({
                  ...f,
                  // Trocar de modelo zera os valores: as lacunas de um não são as do outro.
                  modelo: nome && idioma ? { nome, idioma, valores: {} } : null,
                }));
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("Escolha o modelo")}</option>
              {(modelos ?? []).map((m) => (
                <option key={`${m.name}|${m.language}`} value={`${m.name}|${m.language}`}>
                  {m.name} ({m.language})
                </option>
              ))}
            </select>
          )}

          {conteudoDoModelo?.body && (
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{conteudoDoModelo.body}</p>
          )}

          {lacunas.map((l) => (
            <div key={l.key} className="flex flex-col gap-1">
              <Label htmlFor={`valor-${l.key}`}>
                {t("Valor de {k}").replace("{k}", `{{${l.key}}}`)}{" "}
                <span className="text-xs font-normal text-muted-foreground">({l.onde})</span>
              </Label>
              <Input
                id={`valor-${l.key}`}
                value={form.modelo?.valores[l.key] ?? ""}
                placeholder={l.expects === "text" ? "{{primeiro_nome}}" : t("Link público do arquivo (https://…)")}
                onChange={(e) =>
                  setForm((f) =>
                    f.modelo ? { ...f, modelo: { ...f.modelo, valores: { ...f.modelo.valores, [l.key]: e.target.value } } } : f,
                  )
                }
              />
            </div>
          ))}
          {lacunas.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("Use {{primeiro_nome}} ou {{nome}} para cada cliente receber o próprio nome.")}{" "}
              {form.modelo && (
                <span>
                  {t("Exemplo:")} {Object.values(personalizarValores(form.modelo.valores, NOME_DE_EXEMPLO)).join(" · ")}
                </span>
              )}
            </p>
          )}
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending || !sujo}>
          {isPending ? t("Salvando…") : t("Salvar")}
        </Button>
        {sujo && <span className="text-xs text-muted-foreground">{t("Há alterações não salvas.")}</span>}
      </div>

      <Card className="space-y-4 p-4" data-testid="painel-aniversariantes">
        <div>
          <h2 className="text-sm font-semibold">{t("Aniversariantes")}</h2>
          <p className="text-sm text-muted-foreground">
            {painel
              ? t("{n} contatos têm data de nascimento cadastrada.").replace("{n}", String(painel.contatos_com_data))
              : t("Carregando…")}
          </p>
        </div>

        {painel && painel.contatos_com_data === 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            {t("Nenhum contato tem data de nascimento ainda. Preencha na ficha do contato ou importe uma planilha com a coluna")}{" "}
            <strong>{t("Data de nascimento")}</strong>{" "}
            {t("em")}{" "}
            <Link href="/app/contacts" className="font-medium underline underline-offset-4">
              {t("Contatos")}
            </Link>
            .
          </p>
        )}

        {hoje && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("Hoje")} ({dataCurta(hoje.data)})
            </p>
            {hoje.contatos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ninguém faz aniversário hoje.")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {hoje.contatos.map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/contacts/${c.id}`} className="rounded-full bg-muted px-3 py-1 text-sm hover:bg-muted/70">
                      🎂 {c.nome}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {proximos.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("Próximos 7 dias")}
            </p>
            <ul className="space-y-1 text-sm">
              {proximos.map((d) => (
                <li key={d.data}>
                  <span className="mr-2 font-medium tabular-nums">{dataCurta(d.data)}</span>
                  {d.contatos.map((c) => c.nome).join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {painel && painel.envios.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("Últimos envios")}
            </p>
            <ul className="space-y-1 text-sm">
              {painel.envios.map((e) => (
                <li key={e.data_local} className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">{dataCurta(e.data_local)}</span>
                  {e.bulk_send_id ? (
                    <Link href={`/app/disparos/${e.bulk_send_id}`} className="underline underline-offset-4">
                      {t("{n} mensagens").replace("{n}", String(e.total))}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("ninguém para parabenizar")}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </form>
  );
}
