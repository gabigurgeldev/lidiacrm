"use client";
import { useState } from "react";
import { toast } from "sonner";

import { CartaoDeCanal } from "./CartaoDeCanal";
import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// ⚠️ De `tipo-de-conexao` (módulo PURO) e NÃO de `conta-de-instancias`: aquele
// fala com o Supabase e com a cifra, e importá-lo daqui arrasta `next/headers`
// para o bundle do navegador — o build quebra com "This API is only available in
// Server Components". Foi assim que o `build-and-size` reprovou o primeiro PR.
import { PROVIDER_DA_CONTA } from "@/lib/channels/tipo-de-conexao";
import { lerEstadoDoCanal } from "@/lib/channels/estado";
import {
  useConexoesDaConta,
  useDescobrirInstancias,
  useImportarInstancias,
  useReconectarWebhook,
  type InstanciaDaConta,
} from "@/hooks/channels/useContaDeInstancias";
import { CircleNotch, Warning } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * CONECTAR PELA CONTA — uma chave, vários números.
 *
 * ─── Por que esta tela tem três passos e as outras têm um ───────────────────
 *
 * Porque a credencial aqui é da CONTA, não de um número. Ela alcança todas as
 * instâncias — inclusive as que o operador não quer atender por este CRM (de
 * teste, de outro cliente, desligadas). Importar tudo seria decidir por ele; e
 * pedir os identificadores um a um jogaria fora justamente a vantagem desta
 * forma de conectar, que é o CRM descobrir os números sozinho.
 *
 * Colar a chave → escolher → importar. O passo do meio é o que existe de novo.
 *
 * ─── A chave NÃO é guardada entre os passos ────────────────────────────────
 *
 * Ela fica no estado do formulário e vai junto no POST de importar. Guardá-la
 * numa sessão de servidor ou num cache seria criar mais um lugar por onde ela
 * vaza, para economizar um campo.
 *
 * ─── O selo de cada instância não é enfeite ────────────────────────────────
 *
 * A mesma conta hospeda instância oficial (janela de 24h, fora dela só modelo
 * aprovado) e número ligado por QR (texto livre, risco de banimento). São
 * regras OPOSTAS, e é aqui, na hora de escolher, que a pessoa precisa saber
 * qual está trazendo.
 */
export function CanalContaClient() {
  const t = useT();
  const { label, conectados, isPending } = useConexoesDaConta();
  const descobrir = useDescobrirInstancias();
  const importar = useImportarInstancias();
  const reconectarWebhook = useReconectarWebhook();

  const [apiKey, setApiKey] = useState("");
  const [instancias, setInstancias] = useState<InstanciaDaConta[] | null>(null);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());

  const rotulo = label ?? t("provedor parceiro");

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const r = await descobrir.mutateAsync({ api_key: apiKey.trim() });
    setInstancias(r.data.instancias);
    // Pré-seleciona o que ainda não está aqui — é o que a pessoa quase sempre
    // quer, e desmarcar é mais fácil que marcar oito caixas.
    setEscolhidas(new Set(r.data.instancias.filter((i) => !i.importada).map((i) => i.id)));
  }

  async function trazer() {
    const escolha = (instancias ?? []).filter((i) => escolhidas.has(i.id));
    if (escolha.length === 0) return;
    const r = await importar.mutateAsync({ api_key: apiKey.trim(), instancias: escolha });

    const semWebhook = r.data.importadas.filter((d) => !d.recebendo);
    if (semWebhook.length === 0) {
      toast.success(
        `${escolha.length} ${escolha.length === 1 ? t("número conectado.") : t("números conectados.")}`,
      );
    } else {
      // NÃO é sucesso silencioso: o canal envia e não recebe, que é o defeito
      // mais confuso possível — o operador manda, o cliente responde, e nada
      // chega. Precisa ser dito na hora, com o nome de quem ficou de fora — e
      // com o MOTIVO, não "tente importar de novo": se a causa é escopo da
      // chave, reimportar do zero falha exatamente igual.
      const motivo = semWebhook[0]?.motivo ?? t("o provedor recusou o webhook");
      toast.warning(
        `${t("Conectado, mas sem receber:")} ${semWebhook.map((d) => d.nome).join(", ")}. ${motivo}.`,
      );
    }

    setInstancias(null);
    setEscolhidas(new Set());
    setApiKey("");
  }

  function alternar(id: string) {
    setEscolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  if (isPending) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  return (
    <div className="flex flex-col gap-4" data-testid="canal-conta-root">
      {conectados.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {conectados.length === 1
              ? `1 ${t("número conectado por")} ${rotulo}.`
              : `${conectados.length} ${t("números conectados por")} ${rotulo}.`}
          </p>
          {conectados.map((c) => {
            const estado = c.status ? lerEstadoDoCanal(c.status) : null;
            return (
              <CartaoDeCanal
                key={c.id}
                nome={c.nome ?? t("Número sem nome")}
                telefone={c.telefone}
                provider={PROVIDER_DA_CONTA}
                modo={c.modo}
                estado={estado ? { rotulo: t(estado.rotulo), tom: estado.tom } : null}
                detalhe={
                  <span className="font-mono">{c.instanceId ?? t("sem identificador")}</span>
                }
                acoes={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="btn-reconectar-webhook"
                    disabled={reconectarWebhook.isPending}
                    onClick={async () => {
                      try {
                        await reconectarWebhook.mutateAsync(c.id);
                        toast.success(t("Webhook reconectado."));
                      } catch {
                        // erro já mostrado pelo onError do hook (showApiError)
                      }
                    }}
                  >
                    {reconectarWebhook.isPending ? (
                      <CircleNotch size={14} className="animate-spin" aria-hidden />
                    ) : null}
                    {t("Reconectar webhook")}
                  </Button>
                }
              />
            );
          })}
        </>
      )}

      <div className="ios-grupo p-4">
        <h2 className="font-medium">
          {t("Conectar por")} {rotulo}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Cole a chave de API da sua conta. Ela é validada antes de qualquer coisa ser gravada, e o CRM mostra os números que ela alcança para você escolher quais quer atender aqui.",
          )}
        </p>

        <form onSubmit={buscar} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chave-da-conta">{t("Chave de API da conta")}</Label>
            <Input
              id="chave-da-conta"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
            <span className="text-xs text-muted-foreground">
              {t("Guardada cifrada. Não é exibida de volta em nenhum momento.")}
            </span>
          </div>
          <Button
            type="submit"
            disabled={descobrir.isPending || !apiKey.trim()}
            data-testid="btn-descobrir"
          >
            {descobrir.isPending ? (
              <>
                <CircleNotch size={14} className="animate-spin" aria-hidden />
                {t("Consultando o provedor…")}
              </>
            ) : (
              t("Ver meus números")
            )}
          </Button>
        </form>
      </div>

      {instancias !== null && (
        <div className="ios-grupo" data-testid="instancias-descobertas">
          <div className="p-4">
            <h2 className="font-medium">{t("Escolha os números a atender aqui")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Cada número traz a própria regra de envio: no oficial, fora da janela de 24 horas só sai modelo aprovado; no ligado por QR não há janela, mas há risco de banimento por volume.",
              )}
            </p>
          </div>

          {instancias.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Warning size={16} aria-hidden />
              {t("Esta conta não tem nenhum número. Crie uma instância no painel do provedor primeiro.")}
            </div>
          ) : (
            instancias.map((i) => (
              <label
                key={i.id}
                className="ios-linha cursor-pointer"
                data-clicavel="sim"
                data-testid="instancia-da-conta"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  checked={escolhidas.has(i.id)}
                  onChange={() => alternar(i.id)}
                  aria-label={`${t("Trazer")} ${i.nome ?? i.id}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{i.nome ?? i.id}</span>
                    <TipoDeCanal provider={PROVIDER_DA_CONTA} modo={i.modo} />
                    {i.importada && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t("já está aqui")}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {i.telefone && <span className="font-mono">{i.telefone}</span>}
                    <span>{i.conectada ? t("conectado") : (i.situacao ?? t("desconectado"))}</span>
                  </span>
                </span>
              </label>
            ))
          )}

          {instancias.length > 0 && (
            <div className="flex gap-2 p-3">
              <Button
                onClick={trazer}
                disabled={importar.isPending || escolhidas.size === 0}
                data-testid="btn-importar"
              >
                {importar.isPending ? (
                  <>
                    <CircleNotch size={14} className="animate-spin" aria-hidden />
                    {t("Conectando…")}
                  </>
                ) : (
                  `${t("Conectar")} ${escolhidas.size}`
                )}
              </Button>
              <Button variant="outline" onClick={() => setInstancias(null)}>
                {t("Cancelar")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
