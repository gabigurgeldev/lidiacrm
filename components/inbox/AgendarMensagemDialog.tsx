"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useT } from "@/hooks/i18n/useT";
import {
  useAgendarMensagem,
  useDesmarcarMensagem,
  useScheduledMessages,
} from "@/hooks/inbox/useScheduledMessages";
import { useAttendants } from "@/hooks/team/useAttendants";
import { telefoneDoAvisoSchema } from "@/lib/schemas/mensagem-agendada";
import { CircleNotch, X } from "@/lib/ui/icons";

interface Props {
  conversationId: string;
  /** Número por onde a conversa corre — o padrão do seletor. */
  channelSessionId: string | null;
  nomeDoCliente: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/** `datetime-local` fala hora LOCAL sem fuso: "2026-10-01T09:00". */
function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Amanhã às 9h: o lembrete mais comum, e um horário que a janela aceita. */
function horarioPadrao(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return paraCampoLocal(d);
}

function quandoLegivel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Lembrar → "Agendar mensagem…".
 *
 * O atendente escolhe QUANDO, O QUÊ e POR QUAL NÚMERO o cliente recebe; e, se
 * quiser, um aviso para ele mesmo na mesma hora, num telefone que ele digita
 * (vem preenchido com o "Telefone de aviso" dele, da tela de Equipe). O envio
 * é do cron `scheduled-messages`, que respeita o horário de envio do número.
 *
 * Embaixo, o que já está marcado nesta conversa, com o botão de desmarcar —
 * marcar sem ver o que já existe leva a mandar a mesma coisa duas vezes.
 */
export function AgendarMensagemDialog({
  conversationId,
  channelSessionId,
  nomeDoCliente,
  open,
  onOpenChange,
}: Props) {
  const t = useT();
  const { user } = useAuth();
  // A rota já tira os números excluídos.
  const numeros = useChannelSessions().data ?? [];
  const equipe = useAttendants();
  const pendentes = useScheduledMessages(conversationId, open);
  const agendar = useAgendarMensagem(conversationId);
  const desmarcar = useDesmarcarMensagem(conversationId);

  const meuTelefone = useMemo(
    () => equipe.data?.data.find((a) => a.user_id === user.id)?.notification_phone ?? "",
    [equipe.data, user.id],
  );

  const [quando, setQuando] = useState(horarioPadrao);
  const [texto, setTexto] = useState("");
  const [numero, setNumero] = useState<string>(channelSessionId ?? "");
  const [avisar, setAvisar] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [textoDoAviso, setTextoDoAviso] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  // Reabrir começa limpo: o diálogo anterior pode ter ficado pela metade.
  useEffect(() => {
    if (!open) return;
    setQuando(horarioPadrao());
    setTexto("");
    setNumero(channelSessionId ?? numeros[0]?.id ?? "");
    setAvisar(false);
    setTelefone(meuTelefone);
    setTextoDoAviso(t(`Lembrete: falar com ${nomeDoCliente}.`));
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // O telefone da Equipe pode chegar depois de o diálogo abrir.
  useEffect(() => {
    if (open && !telefone && meuTelefone) setTelefone(meuTelefone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meuTelefone]);

  function salvar() {
    setErro(null);
    const data = new Date(quando);
    if (Number.isNaN(data.getTime())) return setErro(t("Escolha a data e a hora."));
    if (data.getTime() < Date.now() - 60_000) return setErro(t("Escolha um horário no futuro."));
    if (!texto.trim()) return setErro(t("Escreva a mensagem."));
    if (!numero) return setErro(t("Escolha por qual número a mensagem sai."));

    let aviso: { phone: string; body: string } | undefined;
    if (avisar) {
      const tel = telefoneDoAvisoSchema.safeParse(telefone);
      if (!tel.success) return setErro(t("Telefone do aviso inválido. Use DDD e número."));
      if (!textoDoAviso.trim()) return setErro(t("Escreva o texto do aviso."));
      aviso = { phone: tel.data, body: textoDoAviso.trim() };
    }

    agendar.mutate(
      {
        body: texto.trim(),
        scheduled_for: data.toISOString(),
        channel_session_id: numero,
        ...(aviso ? { notify: aviso } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t(`Mensagem agendada para ${quandoLegivel(data.toISOString())}.`));
          setTexto("");
        },
      },
    );
  }

  const lista = pendentes.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="agendar-mensagem">
        <DialogHeader>
          <DialogTitle>{t("Agendar mensagem")}</DialogTitle>
          <DialogDescription>
            {t(`${nomeDoCliente} recebe esta mensagem no horário escolhido.`)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agendar-quando">{t("Data e hora")}</Label>
              <Input
                id="agendar-quando"
                type="datetime-local"
                value={quando}
                min={paraCampoLocal(new Date())}
                onChange={(e) => setQuando(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Enviar pelo número")}</Label>
              <Select value={numero} onValueChange={setNumero}>
                <SelectTrigger aria-label={t("Enviar pelo número")}>
                  <SelectValue placeholder={t("Escolha o número")} />
                </SelectTrigger>
                <SelectContent>
                  {numeros.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {channelLabel(c, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-text-muted">
            {t("Se cair fora do horário de envio do número, sai assim que o horário abrir.")}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="agendar-texto">{t("Mensagem para o cliente")}</Label>
            <Textarea
              id="agendar-texto"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              maxLength={4096}
              placeholder={t("Oi! Passando para lembrar…")}
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="agendar-avisar" className="text-sm">
                {t("Me avisar também no WhatsApp")}
              </Label>
              <Switch id="agendar-avisar" checked={avisar} onCheckedChange={setAvisar} />
            </div>
            {avisar && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="agendar-telefone">{t("Telefone do aviso")}</Label>
                  <Input
                    id="agendar-telefone"
                    inputMode="tel"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="+55 11 98765-4321"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agendar-aviso">{t("Texto do aviso")}</Label>
                  <Textarea
                    id="agendar-aviso"
                    value={textoDoAviso}
                    onChange={(e) => setTextoDoAviso(e.target.value)}
                    rows={2}
                    maxLength={4096}
                  />
                </div>
                <p className="text-xs text-text-muted">
                  {t("O aviso sai pelo mesmo número escolhido acima.")}
                </p>
              </div>
            )}
          </div>

          {erro && (
            <p className="text-sm text-error" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Fechar")}
          </Button>
          <Button onClick={salvar} disabled={agendar.isPending} data-testid="agendar-salvar">
            {agendar.isPending && (
              <CircleNotch size={16} className="mr-2 animate-spin" aria-hidden />
            )}
            {t("Agendar")}
          </Button>
        </DialogFooter>

        {lista.length > 0 && (
          <div className="border-t border-border pt-3" data-testid="agendadas-da-conversa">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("Já agendadas nesta conversa")}
            </p>
            <ul className="space-y-2">
              {lista.map((m) => (
                <li key={m.id} className="flex items-start gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{quandoLegivel(m.scheduled_for)}</p>
                    <p className="line-clamp-2 text-text-muted">{m.body}</p>
                    {m.notify_phone && (
                      <p className="text-xs text-text-muted">{t(`Aviso para ${m.notify_phone}`)}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("Desmarcar")}
                    disabled={desmarcar.isPending}
                    onClick={() => desmarcar.mutate(m.id)}
                  >
                    <X size={14} aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
