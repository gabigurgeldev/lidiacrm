import Link from "next/link";

import { SignupForm } from "@/components/auth/SignupForm";
import { branding } from "@/lib/branding";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Criar conta" };

/**
 * Aceita `?invite=<token>`: é o caminho de quem foi convidado e ainda não tem
 * conta. Sem isso, essa pessoa criava uma conta comum, e o provisionamento —
 * sem encontrar vínculo nenhum — abria uma organização e a tornava admin dela.
 *
 * O token só é lido aqui para MONTAR a tela (esconder o nome da empresa, travar
 * o e-mail). Quem decide o que ele vale é o servidor, duas vezes: ao criar a
 * conta e ao confirmar o e-mail.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const payload = invite ? verifyInviteToken(invite) : null;
  const convite = invite && payload ? { token: invite, email: payload.email } : undefined;
  const conviteExpirado = Boolean(invite) && !payload;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    // Mesmo contrato de `login/page.tsx`: o nome da marca saiu da tela, e este
    // atributo é o que mantém a resolução do `.env` observável para a spec que
    // a cruza com o título da aba. Ver o comentário longo lá.
    <div className="space-y-6" data-marca-do-ambiente={branding().name}>
      <div className="space-y-2 text-center">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-text">
          {t("Criar conta")}
        </h1>
        <p className="text-sm text-text-muted">
          {convite
            ? t("Crie sua senha para entrar na empresa que te convidou")
            : t("Leva menos de um minuto. Você confirma pelo e-mail e já começa.")}
        </p>
      </div>

      {conviteExpirado && (
        <p
          role="alert"
          className="acesso-erro rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2.5 text-sm text-warning"
        >
          {t(
            "Esse convite expirou ou não é mais válido. Peça um novo a quem te convidou — criar uma conta agora abriria uma empresa nova, e não é isso que você quer.",
          )}
        </p>
      )}

      <SignupForm convite={convite} />

      <p className="border-t border-border pt-3 text-sm text-text-muted">
        {t("Já tem conta?")}{" "}
        <Link
          href="/login"
          className="font-semibold text-text underline underline-offset-4 decoration-border-strong transition-colors duration-fast ease-out hover:decoration-text"
        >
          {t("Entrar")}
        </Link>
      </p>
    </div>
  );
}
