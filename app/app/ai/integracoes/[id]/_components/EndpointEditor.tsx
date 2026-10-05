"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useApiErrorHandler } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { renderizarConfirmacao } from "@/lib/ai/integracoes/caminho";
import {
  METODOS,
  ONDE_VAI_O_PARAMETRO,
  TIPOS_DE_PARAMETRO,
  lerParametros,
  type Metodo,
  type ModoDeEndpoint,
  type Parametro,
} from "@/lib/ai/integracoes/schema";
import type { EndpointRow } from "@/lib/ai/integracoes/servidor";
import { apiClient } from "@/lib/api/client";
import { Plus, Trash } from "@/lib/ui/icons";

type LinhaDeParametro = Parametro & { valoresTexto: string };

function paraLinhas(parametros: unknown): LinhaDeParametro[] {
  return lerParametros(parametros).map((p) => ({ ...p, valoresTexto: (p.valores ?? []).join(", ") }));
}

/**
 * Cadastro de um endpoint. A prévia do texto de confirmação mostra exatamente
 * o que o cliente vai ler antes de responder SIM — com valores de exemplo no
 * lugar dos parâmetros.
 */
export function EndpointEditor({
  integracaoId,
  endpoint,
  onClose,
}: {
  integracaoId: string;
  endpoint: EndpointRow | null;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const tratarErro = useApiErrorHandler();
  const [slug, setSlug] = useState(endpoint?.slug ?? "");
  const [titulo, setTitulo] = useState(endpoint?.titulo ?? "");
  const [descricao, setDescricao] = useState(endpoint?.descricao_para_ia ?? "");
  const [metodo, setMetodo] = useState<Metodo>(endpoint?.metodo ?? "GET");
  const [caminho, setCaminho] = useState(endpoint?.caminho ?? "/");
  const [modo, setModo] = useState<ModoDeEndpoint>(endpoint?.modo ?? "leitura");
  const [exigeIdentidade, setExigeIdentidade] = useState(endpoint?.exige_identidade ?? false);
  const [confirmacao, setConfirmacao] = useState(endpoint?.texto_de_confirmacao ?? "");
  const [campos, setCampos] = useState((endpoint?.campos_da_resposta ?? []).join(", "));
  const [timeout, setTimeoutMs] = useState(endpoint?.timeout_ms ?? 8000);
  const [ativo, setAtivo] = useState(endpoint?.ativo ?? true);
  const [parametros, setParametros] = useState<LinhaDeParametro[]>(paraLinhas(endpoint?.parametros));
  const [salvando, setSalvando] = useState(false);

  function mudarParametro(i: number, patch: Partial<LinhaDeParametro>): void {
    setParametros((ps) => ps.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  }

  async function salvar(): Promise<void> {
    setSalvando(true);
    const corpo = {
      slug,
      titulo,
      descricao_para_ia: descricao,
      metodo,
      caminho,
      modo,
      exige_identidade: exigeIdentidade,
      texto_de_confirmacao: modo === "acao" ? confirmacao : null,
      campos_da_resposta: campos
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      timeout_ms: timeout,
      ativo,
      parametros: parametros.map(({ valoresTexto, ...p }) => ({
        ...p,
        ...(p.tipo === "enum"
          ? { valores: valoresTexto.split(",").map((v) => v.trim()).filter(Boolean) }
          : { valores: undefined }),
      })),
    };
    try {
      if (endpoint) {
        await apiClient.patch(`/api/v1/ai/integracoes/${integracaoId}/endpoints/${endpoint.id}`, corpo);
      } else {
        await apiClient.post(`/api/v1/ai/integracoes/${integracaoId}/endpoints`, corpo);
      }
      toast.success(t("Endpoint salvo."));
      onClose();
      router.refresh();
    } catch (err) {
      tratarErro(err);
    } finally {
      setSalvando(false);
    }
  }

  const exemplo = Object.fromEntries(parametros.map((p) => [p.nome, `‹${p.nome}›`]));

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{endpoint ? t("Editar endpoint") : t("Novo endpoint")}</DialogTitle>
          <DialogDescription>
            {t("Use {{params.nome}} no caminho para um parâmetro e {{conta.id}} para a conta verificada do cliente.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ep-titulo">{t("Título")}</Label>
            <Input id="ep-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t("ex.: Status do pedido")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ep-slug">{t("Identificador")}</Label>
            <Input id="ep-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="status_pedido" />
          </div>
          <div className="space-y-1">
            <Label>{t("O que faz")}</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as ModoDeEndpoint)}>
              <SelectTrigger data-testid="ep-modo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leitura">{t("Consulta")}</SelectItem>
                <SelectItem value="acao">{t("Correção (pede SIM)")}</SelectItem>
                <SelectItem value="identidade">{t("Busca de conta por e-mail")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("Método")}</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v as Metodo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METODOS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ep-caminho">{t("Caminho")}</Label>
            <Input id="ep-caminho" value={caminho} onChange={(e) => setCaminho(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ep-desc">{t("Quando o agente deve usar")}</Label>
            <Textarea
              id="ep-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              placeholder={t("ex.: Use quando o cliente perguntar onde está o pedido dele.")}
            />
          </div>
        </div>

        {modo === "identidade" ? (
          <p className="text-xs text-muted-foreground">
            {t("O sistema recebe o parâmetro email e deve responder {\"contas\": [{\"subject_id\": \"...\", \"nome\": \"...\"}]} — lista vazia quando não há conta.")}
          </p>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t("Parâmetros")}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setParametros((ps) => [
                  ...ps,
                  { nome: "", tipo: "string", obrigatorio: true, descricao: "", onde: "query", valoresTexto: "" },
                ])
              }
            >
              <Plus size={12} aria-hidden className="mr-1" /> {t("Parâmetro")}
            </Button>
          </div>
          {parametros.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-6">
              <Input className="sm:col-span-2" value={p.nome} onChange={(e) => mudarParametro(i, { nome: e.target.value })} placeholder={t("nome")} aria-label={t("nome")} />
              <Select value={p.tipo} onValueChange={(v) => mudarParametro(i, { tipo: v as Parametro["tipo"] })}>
                <SelectTrigger aria-label={t("tipo")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DE_PARAMETRO.map((tp) => (
                    <SelectItem key={tp} value={tp}>
                      {tp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={p.onde} onValueChange={(v) => mudarParametro(i, { onde: v as Parametro["onde"] })}>
                <SelectTrigger aria-label={t("onde vai")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ONDE_VAI_O_PARAMETRO.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={p.obrigatorio} onChange={(e) => mudarParametro(i, { obrigatorio: e.target.checked })} />
                {t("obrigatório")}
              </label>
              <Button size="sm" variant="outline" onClick={() => setParametros((ps) => ps.filter((_, n) => n !== i))} aria-label={t("Remover parâmetro")}>
                <Trash size={12} aria-hidden />
              </Button>
              <Input className="sm:col-span-6" value={p.descricao} onChange={(e) => mudarParametro(i, { descricao: e.target.value })} placeholder={t("o que é este valor (o agente lê)")} />
              {p.tipo === "enum" ? (
                <Input className="sm:col-span-6" value={p.valoresTexto} onChange={(e) => mudarParametro(i, { valoresTexto: e.target.value })} placeholder={t("opções separadas por vírgula")} />
              ) : null}
            </div>
          ))}
        </div>

        {modo === "acao" ? (
          <div className="space-y-1">
            <Label htmlFor="ep-confirmacao">{t("Texto que o cliente lê antes de responder SIM")}</Label>
            <Textarea id="ep-confirmacao" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} rows={2} placeholder={t("ex.: Posso reenviar a nota fiscal do pedido {{params.pedido}} para o seu e-mail?")} />
            <p className="text-xs text-muted-foreground" data-testid="previa-confirmacao">
              {t("Prévia")}: {renderizarConfirmacao(confirmacao, exemplo)} {t("Responda SIM para confirmar ou NÃO para cancelar.")}
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ep-campos">{t("Campos da resposta que o agente vê")}</Label>
            <Input id="ep-campos" value={campos} onChange={(e) => setCampos(e.target.value)} placeholder="status, previsao_entrega" />
            <p className="text-xs text-muted-foreground">{t("Vazio = a resposta inteira, sem chaves e senhas.")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ep-timeout">{t("Tempo máximo (ms)")}</Label>
            <Input id="ep-timeout" type="number" min={1000} max={15000} value={timeout} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={exigeIdentidade} onCheckedChange={setExigeIdentidade} aria-label={t("Exige conta verificada")} />
            {t("Exige conta verificada")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={ativo} onCheckedChange={setAtivo} aria-label={t("Ligado")} />
            {t("Ligado")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando} data-testid="ep-salvar">
            {salvando ? t("Salvando…") : t("Salvar endpoint")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
