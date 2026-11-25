"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState, useTransition } from "react";
import { Volume2 } from "lucide-react";

import { salvarSomDeAviso } from "@/app/actions/settings/salvarSomDeAviso";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useUserOpcional } from "@/hooks/auth/AuthProvider";
import { useNotificationPermission } from "@/hooks/notifications/useNotificationPermission";
import { definirSomDeAviso } from "@/lib/notifications/som";
import { playSound, resumeAudio } from "@/lib/notifications/sounds";
import {
  NOTIFY_UI_CATEGORIES,
  canalLigado,
  gravarCanal,
  lerPrefs,
  type NotifyCategory,
  type NotifyChannelPref,
  type NotifyPrefs,
} from "@/lib/notifications/prefs";

const LABELS: Record<NotifyCategory, string> = {
  message: "Nova mensagem",
  lead_assigned: "Lead atribuído a você",
  lead_won: "Lead ganho",
  lead_lost: "Lead perdido",
  mention: "Você foi mencionado",
};

/**
 * O som de aviso, por pessoa (`user_metadata.notify_sound`, ausente = ligado).
 *
 * Fica ACIMA da tabela de canais, e não como mais uma coluna dela, porque não
 * depende de canal nenhum: toca com Push desligado e com o navegador sem
 * permissão. Era exatamente essa dependência que deixava quem tinha só "No
 * sistema" sem som nenhum.
 */
function SomDeAviso() {
  const t = useT();
  const user = useUserOpcional();
  const [ligado, setLigado] = useState(user?.som_de_aviso !== false);
  const [salvando, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function alternar(novo: boolean) {
    const antes = ligado;
    setLigado(novo);
    definirSomDeAviso(novo);
    setErro(null);
    startTransition(async () => {
      const r = await salvarSomDeAviso({ ligado: novo });
      if (!r.ok) {
        setLigado(antes);
        definirSomDeAviso(antes);
        setErro(t("Não foi possível salvar. Tente de novo."));
      }
    });
  }

  async function testar() {
    // O clique também destrava o áudio do navegador para a sessão.
    await resumeAudio().catch(() => {});
    playSound("message", 1.0);
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("Tocar som quando chegar mensagem ou lead novo")}</p>
        <p className="text-xs text-muted-foreground">
          {t(
            "Toca no computador em que você estiver com o sistema aberto, para as conversas que são suas. Vale só para você.",
          )}
        </p>
        {erro ? <p className="text-xs text-destructive">{erro}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void testar()}
          data-testid="som-de-aviso-testar"
        >
          <Volume2 size={14} />
          {t("Testar som")}
        </Button>
        <Switch
          checked={ligado}
          disabled={salvando}
          onCheckedChange={alternar}
          aria-label={t("Tocar som quando chegar mensagem ou lead novo")}
          data-testid="som-de-aviso"
        />
      </div>
    </Card>
  );
}

export function NotificationPrefsClient() {
  return (
    <div className="flex flex-col gap-4">
      <SomDeAviso />
      <CanaisPorCategoria />
    </div>
  );
}

function CanaisPorCategoria() {
  const t = useT();
  const { permission, request } = useNotificationPermission();
  const [prefs, setPrefs] = useState<NotifyPrefs>(() => lerPrefs());
  const denied = permission === "denied";
  const unsupported = permission === "unsupported";

  async function onToggle(category: NotifyCategory, channel: NotifyChannelPref, on: boolean) {
    if (channel === "push" && on) {
      if (permission !== "granted") {
        const next = await request();
        if (next !== "granted") return;
      }
    }
    setPrefs(gravarCanal(category, channel, on));
  }

  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="px-4 py-3 text-left font-medium">{t("Categoria")}</th>
            <th className="px-4 py-3 text-center font-medium">Email</th>
            <th className="px-4 py-3 text-center font-medium">In-app</th>
            <th className="px-4 py-3 text-center font-medium">Push</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFY_UI_CATEGORIES.map((cat) => (
            <tr key={cat} className="border-b last:border-0">
              <td className="px-4 py-3">
                {t(LABELS[cat])}
                {cat === "message" && denied ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      "O navegador bloqueou as notificações. Libere-as nas configurações do site e recarregue.",
                    )}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3 text-center">
                <Switch checked={false} disabled aria-label={`${t(LABELS[cat])} via email`} />
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={prefs[cat].in_app}
                  onCheckedChange={(on) => void onToggle(cat, "in_app", on)}
                  aria-label={`${t(LABELS[cat])} via in_app`}
                />
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={prefs[cat].push}
                  disabled={denied || unsupported}
                  onCheckedChange={(on) => void onToggle(cat, "push", on)}
                  aria-label={`${t(LABELS[cat])} via push`}
                  data-testid={cat === "message" ? (canalLigado("message", "push") ? "alerts-toggle" : "alerts-enable") : undefined}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
