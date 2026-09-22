"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProfile } from "@/app/actions/settings/updateProfile";
import { useT } from "@/hooks/i18n/useT";
import { useAplicarIdioma, useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { Idioma } from "@/lib/i18n/idiomas";
import {
  profileSchema,
  SEM_PREFERENCIA_DE_IDIOMA,
  type Locale,
} from "@/lib/schemas/settings";

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Recife",
  "America/Fortaleza",
  "UTC",
];

interface Props {
  email: string;
  initialFullName: string | null;
  initialAvatarUrl: string | null;
  initialLocale: Locale | typeof SEM_PREFERENCIA_DE_IDIOMA;
  initialTimezone: string;
}

export function ProfileForm({
  email,
  initialFullName,
  initialAvatarUrl,
  initialLocale,
  initialTimezone,
}: Props) {
  const t = useT();
  const aplicarIdioma = useAplicarIdioma();
  // O idioma EM VIGOR — para onde a interface volta quando a escolha é "seguir
  // o da empresa": a preferência pessoal é apagada, e quem passa a valer é a
  // cadeia resolvida no servidor, que já é o que esta tela está mostrando.
  const idiomaAtual = useIdioma();
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [locale, setLocale] = useState<Locale | typeof SEM_PREFERENCIA_DE_IDIOMA>(initialLocale);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileSchema.safeParse({
      full_name: fullName || null,
      locale,
      timezone,
      avatar_url: avatarUrl || null,
    });
    if (!parsed.success) {
      toast.error(t("Dados inválidos."));
      return;
    }
    const trocouDeIdioma = locale !== initialLocale;
    startTransition(async () => {
      const r = await updateProfile(parsed.data);
      if (!r.ok) {
        toast.error(`${t("Erro")}: ${r.error}`);
        return;
      }
      toast.success(t("Perfil atualizado."));
      if (!trocouDeIdioma) return;

      // Pinta antes de recarregar: o `IdiomaProvider` guarda um estado local
      // para o efeito aparecer no ato, e sem esta chamada ele ficaria com o
      // idioma velho durante o tempo de ida e volta da recarga.
      aplicarIdioma(locale === SEM_PREFERENCIA_DE_IDIOMA ? idiomaAtual : (locale as Idioma));

      // ⚠️ RECARGA INTEIRA, e não `router.refresh()` — os dois foram MEDIDOS,
      // e esta linha veio do `SeletorDeIdioma` do cabeçalho quando ele saiu.
      //
      // O problema: `revalidatePath` invalida o cache do SERVIDOR. O Router
      // Cache do CLIENTE é outro, e guarda o layout de `/app` já renderizado —
      // que é justamente quem monta o `IdiomaProvider`. Numa sonda Playwright,
      // sem nada disto: logo após salvar a tela mostrava o idioma novo (o estado
      // local pintando), ao NAVEGAR ela voltava ao antigo, e só um reload
      // acertava. A troca parecia funcionar e se desfazia sozinha na primeira
      // navegação — o pior desfecho possível.
      //
      // `router.refresh()` melhora e não resolve: medido na mesma sonda, a
      // PRIMEIRA navegação depois ainda vinha no idioma antigo e só a SEGUNDA
      // vinha certa. Ele é assíncrono, e quem salva e sai navegando ganha a
      // corrida dele.
      //
      // ⚠️ Esta tela é HOJE o único lugar que troca o idioma da interface — o
      // seletor do cabeçalho não existe mais. Tirar a recarga daqui devolve o
      // defeito acima sem nenhum outro caminho para compensá-lo.
      window.location.reload();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="email">{t("Email")}</Label>
          <Input id="email" value={email} disabled />
          <p className="text-xs text-muted-foreground">
            {t("Trocar email — em breve.")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="full_name">{t("Nome completo")}</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="locale">{t("Idioma")}</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_PREFERENCIA_DE_IDIOMA}>
                  {t("Seguir o idioma da empresa")}
                </SelectItem>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                {/* Espanhol entrou quando passou a MUDAR alguma coisa. Enquanto
                    o campo era guardado e ninguém o lia, oferecer um idioma a
                    mais era prometer o que a tela não cumpre — e o operador
                    conclui que o sistema está quebrado.
                    `en-US` saiu pela mesma razão: nunca teve tradução. */}
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{t("Fuso horário")}</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="avatar_url">{t("Avatar URL")}</Label>
          <Input
            id="avatar_url"
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("Upload de arquivo — em breve. Cole uma URL pública.")}
          </p>
        </div>
        <div className="flex sm:justify-end">
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </Card>
    </form>
  );
}
