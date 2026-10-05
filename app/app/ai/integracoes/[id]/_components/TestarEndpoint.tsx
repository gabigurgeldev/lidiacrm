"use client";

import { useState } from "react";

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
import { useT } from "@/hooks/i18n/useT";
import { lerParametros } from "@/lib/ai/integracoes/schema";
import type { EndpointRow } from "@/lib/ai/integracoes/servidor";
import { apiClient } from "@/lib/api/client";

type Resultado = { ok: boolean; mensagem: string; http_status?: number | null; o_que_o_agente_ve?: string | null };

/**
 * "Testar" mostra o que o AGENTE veria — já projetado e com segredos ocultos —
 * e não a resposta crua. Testar uma CORREÇÃO altera o sistema de verdade, por
 * isso pede uma segunda confirmação.
 */
export function TestarEndpoint({
  integracaoId,
  endpoint,
  podeExecutarAcao,
  onClose,
}: {
  integracaoId: string;
  endpoint: EndpointRow;
  podeExecutarAcao: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const tratarErro = useApiErrorHandler();
  const parametros = lerParametros(endpoint.parametros);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [contaId, setContaId] = useState("");
  const [contaEmail, setContaEmail] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ehAcao = endpoint.modo === "acao";

  async function testar(): Promise<void> {
    if (ehAcao && !window.confirm(t("Testar uma correção ALTERA o sistema de verdade. Executar mesmo assim?"))) return;
    setOcupado(true);
    try {
      const convertidos: Record<string, unknown> = {};
      for (const p of parametros) {
        const v = valores[p.nome];
        if (v === undefined || v === "") continue;
        convertidos[p.nome] = p.tipo === "boolean" ? v === "true" : v;
      }
      const r = await apiClient.post<{ data: Resultado }>(
        `/api/v1/ai/integracoes/${integracaoId}/endpoints/${endpoint.id}/testar`,
        {
          parametros: convertidos,
          ...(contaId.trim() ? { conta_de_teste: { id: contaId.trim(), email: contaEmail.trim() } } : {}),
          executar_de_verdade: ehAcao,
        },
        { semRepetir: true, timeoutMs: 20_000 },
      );
      setResultado(r.data);
    } catch (err) {
      tratarErro(err);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("Testar")}: {endpoint.titulo}
          </DialogTitle>
          <DialogDescription>{t("A chamada é real. O resultado mostra o que o agente receberia.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {parametros.map((p) => (
            <div key={p.nome} className="space-y-1">
              <Label htmlFor={`tp-${p.nome}`}>
                {p.nome}
                {p.obrigatorio ? " *" : ""}
              </Label>
              <Input
                id={`tp-${p.nome}`}
                value={valores[p.nome] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [p.nome]: e.target.value }))}
                placeholder={p.descricao}
              />
            </div>
          ))}
          {endpoint.exige_identidade ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="tp-conta">{t("Conta de teste (id)")}</Label>
                <Input id="tp-conta" value={contaId} onChange={(e) => setContaId(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tp-email">{t("E-mail da conta de teste")}</Label>
                <Input id="tp-email" value={contaEmail} onChange={(e) => setContaEmail(e.target.value)} />
              </div>
            </div>
          ) : null}
          {resultado ? (
            <div className="space-y-1" data-testid="resultado-teste-endpoint">
              <p className={resultado.ok ? "text-sm text-success-fg" : "text-sm text-destructive"}>
                {resultado.http_status ? `HTTP ${resultado.http_status} · ` : ""}
                {resultado.mensagem}
              </p>
              {resultado.o_que_o_agente_ve ? (
                <pre className="max-h-64 overflow-auto rounded-md bg-surface-elevated p-2 text-xs">{resultado.o_que_o_agente_ve}</pre>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Fechar")}
          </Button>
          <Button onClick={() => void testar()} disabled={ocupado || (ehAcao && !podeExecutarAcao)} data-testid="tp-executar">
            {ocupado ? t("Chamando…") : ehAcao ? t("Executar de verdade") : t("Chamar agora")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
