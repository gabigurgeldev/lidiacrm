"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useApiErrorHandler } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import type { EndpointRow, IntegracaoRow } from "@/lib/ai/integracoes/servidor";
import { apiClient } from "@/lib/api/client";
import { Plus } from "@/lib/ui/icons";

import { SeloDeSaude } from "../../_components/ListaDeIntegracoes";
import { EndpointEditor } from "./EndpointEditor";
import { TestarEndpoint } from "./TestarEndpoint";
import { GATILHO_DA_ABA, SEGMENTADO_ABAS } from "@/components/ajustes";

interface Props {
  integracao: IntegracaoRow;
  endpoints: EndpointRow[];
  podeEscrever: boolean;
}

export function PainelDaIntegracao({ integracao, endpoints, podeEscrever }: Props) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{integracao.nome}</h1>
        <SeloDeSaude i={integracao} />
        {integracao.tipo === "suporte_v1" ? <Badge variant="info">{t("Contrato de Suporte v1")}</Badge> : null}
      </header>
      <Tabs defaultValue="endpoints">
        <TabsList className={`${SEGMENTADO_ABAS} max-w-full self-start overflow-x-auto`}>
          <TabsTrigger value="endpoints" className={GATILHO_DA_ABA}>{t("Endpoints")}</TabsTrigger>
          <TabsTrigger value="conexao" className={GATILHO_DA_ABA}>{t("Conexão")}</TabsTrigger>
          <TabsTrigger value="atividade" className={GATILHO_DA_ABA}>{t("Atividade")}</TabsTrigger>
        </TabsList>
        <TabsContent value="endpoints">
          <AbaEndpoints integracao={integracao} endpoints={endpoints} podeEscrever={podeEscrever} />
        </TabsContent>
        <TabsContent value="conexao">
          <AbaConexao integracao={integracao} endpoints={endpoints} podeEscrever={podeEscrever} />
        </TabsContent>
        <TabsContent value="atividade">
          <AbaAtividade integracao={integracao} endpoints={endpoints} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────── Endpoints ───────────────────────────────

function AbaEndpoints({ integracao, endpoints, podeEscrever }: Props) {
  const t = useT();
  const router = useRouter();
  const tratarErro = useApiErrorHandler();
  const [editando, setEditando] = useState<EndpointRow | "novo" | null>(null);
  const [testando, setTestando] = useState<EndpointRow | null>(null);
  const [importando, setImportando] = useState(false);

  async function importar(): Promise<void> {
    setImportando(true);
    try {
      const r = await apiClient.post<{ data: { sistema: string; criados: number; atualizados: number; mantidos: number } }>(
        `/api/v1/ai/integracoes/${integracao.id}/importar-catalogo`,
        {},
        { semRepetir: true, timeoutMs: 20_000 },
      );
      toast.success(
        `${r.data.sistema}: ${r.data.criados} ${t("novos")}, ${r.data.atualizados} ${t("atualizados")}, ${r.data.mantidos} ${t("mantidos")}`,
      );
      router.refresh();
    } catch (err) {
      tratarErro(err);
    } finally {
      setImportando(false);
    }
  }

  async function apagar(e: EndpointRow): Promise<void> {
    if (!window.confirm(t("Apagar este endpoint? Agentes que o usavam deixam de chamá-lo."))) return;
    try {
      await apiClient.delete(`/api/v1/ai/integracoes/${integracao.id}/endpoints/${e.id}`);
      router.refresh();
    } catch (err) {
      tratarErro(err);
    }
  }

  const rotuloModo = (m: EndpointRow["modo"]): string =>
    m === "acao" ? t("Correção (pede SIM)") : m === "identidade" ? t("Busca de conta por e-mail") : t("Consulta");

  return (
    <div className="flex flex-col gap-3">
      {podeEscrever ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {integracao.tipo === "suporte_v1" ? (
            <Button variant="outline" onClick={() => void importar()} disabled={importando} data-testid="importar-catalogo">
              {importando ? t("Importando…") : t("Importar catálogo")}
            </Button>
          ) : null}
          <Button onClick={() => setEditando("novo")} data-testid="novo-endpoint">
            <Plus size={14} aria-hidden className="mr-2" /> {t("Novo endpoint")}
          </Button>
        </div>
      ) : null}

      {endpoints.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="endpoints-vazio">
          {integracao.tipo === "suporte_v1"
            ? t("Nenhum endpoint ainda. Use \"Importar catálogo\" para trazer o que o sistema oferece.")
            : t("Nenhum endpoint ainda. Cadastre o primeiro: o que o agente pode consultar neste sistema.")}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {endpoints.map((e) => (
            <Card key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid={`endpoint-linha-${e.slug}`}>
              <div className="min-w-0">
                <p className="font-medium">
                  {e.titulo} <span className="text-xs font-normal text-muted-foreground">({e.slug})</span>
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {e.metodo} {e.caminho}
                </p>
                <p className="text-xs text-muted-foreground">
                  {rotuloModo(e.modo)}
                  {e.exige_identidade ? ` · ${t("exige conta verificada")}` : ""}
                  {!e.ativo ? ` · ${t("desligado")}` : ""}
                  {integracao.identidade_endpoint_id === e.id ? ` · ${t("usado na verificação")}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setTestando(e)}>
                  {t("Testar")}
                </Button>
                {podeEscrever ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEditando(e)}>
                      {t("Editar")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void apagar(e)}>
                      {t("Apagar")}
                    </Button>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editando !== null ? (
        <EndpointEditor
          integracaoId={integracao.id}
          endpoint={editando === "novo" ? null : editando}
          onClose={() => setEditando(null)}
        />
      ) : null}
      {testando !== null ? (
        <TestarEndpoint
          integracaoId={integracao.id}
          endpoint={testando}
          podeExecutarAcao={podeEscrever}
          onClose={() => setTestando(null)}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Conexão ───────────────────────────────

function AbaConexao({ integracao, endpoints, podeEscrever }: Props) {
  const t = useT();
  const router = useRouter();
  const tratarErro = useApiErrorHandler();
  const [nome, setNome] = useState(integracao.nome);
  const [baseUrl, setBaseUrl] = useState(integracao.base_url);
  const [ativo, setAtivo] = useState(integracao.ativo);
  const [verifica, setVerifica] = useState(integracao.identidade_modo === "email_otp");
  const [horas, setHoras] = useState(integracao.sessao_horas);
  const [segredo, setSegredo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; mensagem: string } | null>(null);

  const temIdentidade = endpoints.some((e) => e.modo === "identidade");

  async function salvar(): Promise<void> {
    setOcupado(true);
    try {
      await apiClient.patch(`/api/v1/ai/integracoes/${integracao.id}`, {
        nome,
        base_url: baseUrl,
        ativo,
        identidade_modo: verifica ? "email_otp" : "nenhuma",
        sessao_horas: horas,
      });
      if (segredo.trim().length > 0) {
        await apiClient.put(`/api/v1/ai/integracoes/${integracao.id}/segredo`, { segredo: segredo.trim() });
        setSegredo("");
      }
      toast.success(t("Integração salva."));
      router.refresh();
    } catch (err) {
      tratarErro(err);
    } finally {
      setOcupado(false);
    }
  }

  async function testar(): Promise<void> {
    setOcupado(true);
    try {
      const r = await apiClient.post<{ data: { ok: boolean; mensagem: string } }>(
        `/api/v1/ai/integracoes/${integracao.id}/testar-conexao`,
        {},
        { semRepetir: true, timeoutMs: 15_000 },
      );
      setTeste(r.data);
      router.refresh();
    } catch (err) {
      tratarErro(err);
    } finally {
      setOcupado(false);
    }
  }

  async function arquivar(): Promise<void> {
    if (!window.confirm(t("Arquivar esta integração? Os agentes param de consultá-la."))) return;
    try {
      await apiClient.delete(`/api/v1/ai/integracoes/${integracao.id}`);
      router.push("/app/ai/integracoes");
    } catch (err) {
      tratarErro(err);
    }
  }

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-4">
      <div className="space-y-1">
        <Label htmlFor="cx-nome">{t("Nome do sistema")}</Label>
        <Input id="cx-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!podeEscrever} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cx-url">{t("Endereço base da API")}</Label>
        <Input id="cx-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!podeEscrever} />
      </div>
      {integracao.auth_tipo !== "nenhuma" ? (
        <div className="space-y-1">
          <Label htmlFor="cx-segredo">{t("Chave de acesso")}</Label>
          <Input
            id="cx-segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder={integracao.segredo_last4 ? `•••• ${integracao.segredo_last4}` : t("nenhuma chave cadastrada")}
            disabled={!podeEscrever}
          />
          <p className="text-xs text-muted-foreground">{t("Deixe em branco para manter a chave atual.")}</p>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("Verificar o dono da conta por e-mail")}</p>
          <p className="text-xs text-muted-foreground">
            {t("O agente pede o e-mail da conta, manda um código e só consulta a conta depois que o cliente digita o código certo.")}
          </p>
          {verifica && !temIdentidade ? (
            <p className="text-xs text-warning-fg">
              {t("Falta um endpoint do tipo \"Busca de conta por e-mail\" — sem ele, a verificação não tem a quem perguntar.")}
            </p>
          ) : null}
        </div>
        <Switch checked={verifica} onCheckedChange={setVerifica} disabled={!podeEscrever} aria-label={t("Verificar o dono da conta por e-mail")} />
      </div>
      {verifica ? (
        <div className="space-y-1">
          <Label htmlFor="cx-horas">{t("Por quantas horas a verificação vale")}</Label>
          <Input id="cx-horas" type="number" min={1} max={24} value={horas} onChange={(e) => setHoras(Number(e.target.value))} disabled={!podeEscrever} />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("Ligada")}</p>
        <Switch checked={ativo} onCheckedChange={setAtivo} disabled={!podeEscrever} aria-label={t("Ligada")} />
      </div>

      {teste ? (
        <p className={teste.ok ? "text-sm text-success-fg" : "text-sm text-destructive"} data-testid="resultado-teste-conexao">
          {teste.mensagem}
        </p>
      ) : integracao.ultimo_teste_erro ? (
        <p className="text-sm text-destructive">{integracao.ultimo_teste_erro}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void testar()} disabled={ocupado} data-testid="testar-conexao">
          {t("Testar conexão")}
        </Button>
        {podeEscrever ? (
          <>
            <Button onClick={() => void salvar()} disabled={ocupado} data-testid="salvar-conexao">
              {t("Salvar")}
            </Button>
            <Button variant="outline" onClick={() => void arquivar()} disabled={ocupado}>
              {t("Arquivar")}
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────────── Atividade ───────────────────────────────

type Atividade = {
  chamadas: Array<{ id: string; endpoint_id: string | null; origem: string; http_status: number | null; ok: boolean; erro_codigo: string | null; duracao_ms: number | null; created_at: string }>;
  acoes: Array<{ id: string; endpoint_id: string; resumo: string; status: string; resultado: string | null; created_at: string }>;
  ultimas_24h: { total: number; falhas: number };
};

function AbaAtividade({ integracao, endpoints }: { integracao: IntegracaoRow; endpoints: EndpointRow[] }) {
  const t = useT();
  const [dados, setDados] = useState<Atividade | null>(null);
  const nomeDo = (id: string | null): string => endpoints.find((e) => e.id === id)?.titulo ?? t("conexão");

  useEffect(() => {
    let vivo = true;
    void apiClient
      .get<{ data: Atividade }>(`/api/v1/ai/integracoes/${integracao.id}/chamadas`)
      .then((r) => {
        if (vivo) setDados(r.data);
      })
      .catch(() => {
        if (vivo) setDados({ chamadas: [], acoes: [], ultimas_24h: { total: 0, falhas: 0 } });
      });
    return () => {
      vivo = false;
    };
  }, [integracao.id]);

  if (!dados) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  const rotuloStatus: Record<string, string> = {
    aguardando: t("esperando o SIM"),
    executando: t("executando"),
    executada: t("aplicada"),
    falhou: t("falhou"),
    cancelada: t("não autorizada"),
    expirada: t("venceu sem resposta"),
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("Últimas 24 horas")}: {dados.ultimas_24h.total} {t("chamadas")}, {dados.ultimas_24h.falhas} {t("com falha")}.
      </p>
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-medium">{t("Correções propostas")}</h3>
        {dados.acoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma correção proposta ainda.")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {dados.acoes.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0">
                <span>{nomeDo(a.endpoint_id)}</span>
                <span className="text-muted-foreground">
                  {rotuloStatus[a.status] ?? a.status} · {new Date(a.created_at).toLocaleString()}
                </span>
                {a.resultado ? <span className="w-full text-xs text-muted-foreground">{a.resultado}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-medium">{t("Chamadas")}</h3>
        {dados.chamadas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma chamada ainda.")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {dados.chamadas.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {nomeDo(c.endpoint_id)} · {c.origem}
                </span>
                <span className={c.ok ? "text-success-fg" : "text-destructive"}>
                  {c.http_status ?? "—"} {c.erro_codigo ?? ""} · {c.duracao_ms ?? 0} ms · {new Date(c.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
