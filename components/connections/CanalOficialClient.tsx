"use client";
import { useState } from "react";
import { toast } from "sonner";

import { CartaoDeCanal } from "./CartaoDeCanal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { lerEstadoDoCanal } from "@/lib/channels/estado";
import {
  useConnectOfficialChannel,
  useOfficialChannels,
  useRenameOfficialChannel,
  type OfficialChannel,
} from "@/hooks/channels/useOfficialChannel";
import { copyToClipboard } from "@/lib/clipboard";
import { Plus, PencilSimple } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/** Campo somente-leitura com botão de copiar — o que o operador cola na Meta. */
function ParaColar({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  const t = useT();
  if (!valor) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {rotulo}
        </span>
        <span className="text-sm text-destructive">
          {t("não configurado nesta instalação — defina no servidor antes de continuar")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">{valor}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await copyToClipboard(valor);
            toast.success(t("Copiado."));
          }}
        >
          {t("Copiar")}
        </Button>
      </div>
    </div>
  );
}

/**
 * O que colar na Meta para UM número.
 *
 * Dentro do cartão do canal, e não numa seção geral da aba: a URL de callback é
 * por linha (`webhook_path_token`), e uma seção única mostrando "a" URL faria o
 * operador colar o endereço do primeiro número no painel do segundo — a Meta
 * aceitaria, e as respostas do segundo número entrariam no canal errado.
 */
function ColeNaMeta({ canal }: { canal: OfficialChannel }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-surface-elevated/40 p-4">
      <div>
        <h3 className="text-sm font-medium">{t("Cole isto no painel da Meta")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Em")} <strong>WhatsApp → {t("Configuração")}</strong>
          {t(", na seção de Webhook. Sem esse passo o canal envia, mas")}{" "}
          <strong>{t("não recebe")}</strong>
          {t(" — as respostas do cliente não chegam e a janela de 24 horas nunca abre.")}
        </p>
      </div>
      <ParaColar rotulo={t("URL de callback")} valor={canal.webhook.callbackUrl} />
      <ParaColar rotulo={t("Token de verificação")} valor={canal.webhook.verifyToken} />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Campos a assinar")}
        </span>
        <div className="flex flex-wrap gap-1">
          {canal.webhook.fields.map((f) => (
            <Badge key={f} variant="outline" className="font-mono text-xs">
              {f}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Renomear em linha. Sem diálogo: é um campo só, e um modal para um campo cansa. */
function Renomear({ canal, onPronto }: { canal: OfficialChannel; onPronto: () => void }) {
  const t = useT();
  const renomear = useRenameOfficialChannel();
  const [nome, setNome] = useState(canal.displayName ?? "");

  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await renomear.mutateAsync({ id: canal.id, display_name: nome.trim() });
        toast.success(t("Salvo."));
        onPronto();
      }}
    >
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        aria-label={t("Nome deste número")}
        className="h-8"
        maxLength={80}
        required
        autoFocus
      />
      <Button size="sm" type="submit" disabled={renomear.isPending || !nome.trim()}>
        {t("Salvar")}
      </Button>
      <Button size="sm" variant="outline" type="button" onClick={onPronto}>
        {t("Cancelar")}
      </Button>
    </form>
  );
}

export function CanalOficialClient() {
  const t = useT();
  const { canais, isPending } = useOfficialChannels();
  const conectar = useConnectOfficialChannel();
  const [form, setForm] = useState({
    phone_number_id: "",
    waba_id: "",
    token: "",
    display_name: "",
  });
  // O formulário fica FECHADO quando já há canal: com um número conectado, a
  // pergunta da tela deixa de ser "como conecto" e passa a ser "quais tenho".
  // Um formulário sempre aberto empurra a lista para baixo da dobra — e foi
  // isso que fez a versão anterior parecer uma tela de canal único.
  const [abrindoNovo, setAbrindoNovo] = useState(false);
  const [renomeando, setRenomeando] = useState<string | null>(null);

  const mostrarForm = abrindoNovo || canais.length === 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const r = await conectar.mutateAsync({
      phone_number_id: form.phone_number_id,
      waba_id: form.waba_id,
      token: form.token,
      ...(form.display_name.trim() ? { display_name: form.display_name.trim() } : {}),
    });
    toast.success(`${t("Conectado:")} ${r.data.displayName} ${r.data.phoneNumber ?? ""}`.trim());
    // O token some do formulário assim que grava — deixá-lo na tela seria mantê-lo
    // em memória do navegador sem motivo, e ele não volta em nenhum GET.
    setForm({ phone_number_id: "", waba_id: "", token: "", display_name: "" });
    setAbrindoNovo(false);
  }

  if (isPending) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  return (
    <div className="flex flex-col gap-4" data-testid="canal-oficial-root">
      {canais.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {canais.length === 1
              ? t("1 número oficial conectado.")
              : `${canais.length} ${t("números oficiais conectados.")}`}
          </p>
          <Button size="sm" onClick={() => setAbrindoNovo((v) => !v)}>
            <Plus size={14} aria-hidden />
            {t("Conectar outro número")}
          </Button>
        </div>
      )}

      {canais.map((canal) => {
        const estado = canal.status ? lerEstadoDoCanal(canal.status) : null;
        return (
          <CartaoDeCanal
            key={canal.id}
            // O testid é o MESMO de quando havia um cartão só: `canal-oficial`
            // (jornada) o procura, e rótulo de teste é contrato tanto quanto
            // rótulo visível. O que mudou é haver vários.
            nome={canal.displayName ?? t("Canal oficial")}
            telefone={canal.phoneNumber}
            provider={CHANNEL_PROVIDER_META}
            estado={estado ? { rotulo: t(estado.rotulo), tom: estado.tom } : null}
            detalhe={
              <span data-testid="canal-conectado">
                WABA <span className="font-mono">{canal.wabaId}</span> · {t("número")}{" "}
                <span className="font-mono">{canal.phoneNumberId}</span>{" "}
                {/* Mostra que o token EXISTE, nunca qual é. */}
                <Badge
                  variant={canal.hasToken ? "outline" : "destructive"}
                  className="ml-1 align-middle"
                >
                  {canal.hasToken ? t("credencial guardada") : t("sem credencial")}
                </Badge>
              </span>
            }
            aviso={<ColeNaMeta canal={canal} />}
            acoes={
              renomeando === canal.id ? (
                <Renomear canal={canal} onPronto={() => setRenomeando(null)} />
              ) : (
                <Button size="sm" variant="outline" onClick={() => setRenomeando(canal.id)}>
                  <PencilSimple size={14} aria-hidden />
                  {t("Renomear")}
                </Button>
              )
            }
          />
        );
      })}

      {mostrarForm && (
        <div className="ios-grupo p-4">
          <h2 className="font-medium">
            {canais.length > 0 ? t("Conectar outro número") : t("Conectar canal oficial")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Os três valores vêm do seu app na Meta (")}
            <strong>WhatsApp → {t("Configuração da API")}</strong>
            {t("). A credencial é")} <strong>{t("validada com a Meta antes de ser gravada")}</strong>
            {t(" — se o número não responder, nada é salvo.")}
          </p>

          <form onSubmit={enviar} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pnid">{t("ID do número de telefone")}</Label>
              <Input
                id="pnid"
                value={form.phone_number_id}
                onChange={(e) => setForm((f) => ({ ...f, phone_number_id: e.target.value }))}
                placeholder="1103328999528818"
                required
              />
              <span className="text-xs text-muted-foreground">
                {t(
                  "É por este ID que o número é reconhecido: repetir um já conectado atualiza aquele canal em vez de criar outro.",
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="waba">{t("ID da conta do WhatsApp Business")}</Label>
              <Input
                id="waba"
                value={form.waba_id}
                onChange={(e) => setForm((f) => ({ ...f, waba_id: e.target.value }))}
                placeholder="2434045433735175"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apelido">{t("Nome deste número")}</Label>
              <Input
                id="apelido"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder={t("Vendas")}
                maxLength={80}
              />
              <span className="text-xs text-muted-foreground">
                {t(
                  "Opcional. Sem ele o número herda o nome verificado da Meta — que é o mesmo para todos os números da conta.",
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tok">{t("Token de acesso")}</Label>
              <Input
                id="tok"
                type="password"
                value={form.token}
                onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                placeholder="EAAG…"
                required
              />
              <span className="text-xs text-muted-foreground">
                {t("Guardado cifrado. Não é exibido de volta em nenhum momento.")}
              </span>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={conectar.isPending} data-testid="btn-conectar">
                {conectar.isPending ? t("Validando com a Meta…") : t("Validar e conectar")}
              </Button>
              {canais.length > 0 && (
                <Button type="button" variant="outline" onClick={() => setAbrindoNovo(false)}>
                  {t("Cancelar")}
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
