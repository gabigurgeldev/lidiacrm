"use client";

import { useForm } from "react-hook-form";
import { EnvelopeSimpleIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { CampoDeAcesso } from "@/components/auth/CampoDeAcesso";
import { signInWithPassword, type SignInResult } from "@/app/actions/auth/signInWithPassword";
import { MENSAGEM_DE_INSTABILIDADE } from "@/lib/auth/erro-do-gotrue";
import { ehRedirectDoNext } from "@/lib/auth/redirect-do-next";

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values: LoginInput) => {
    setServerError(null);
    startTransition(async () => {
      // Server Action redirects on success — no return value reaches here.
      // On failure, an error discriminator is returned and rendered inline.
      let res: SignInResult | undefined;
      try {
        res = await signInWithPassword(values, next);
      } catch (err) {
        // A ação redireciona no sucesso — esse "erro" é a navegação.
        if (ehRedirectDoNext(err)) throw err;
        // Rede caída ou servidor sem resposta: a ação nem chegou a dizer nada.
        // Sem isto a promessa rejeitada subia até a tela de erro do Next.
        setServerError(t(MENSAGEM_DE_INSTABILIDADE));
        return;
      }
      if (!res) {
        // Should be unreachable (redirect throws), but guard anyway.
        router.replace(next || "/app/inbox");
        return;
      }
      if (res.error === "mfa_required") {
        const params = new URLSearchParams();
        if (next) params.set("next", next);
        if (res.challengeId) params.set("factor", res.challengeId);
        router.replace(`/login/mfa${params.toString() ? `?${params}` : ""}`);
        return;
      }
      if (res.error === "invalid_credentials") {
        setServerError(t("Email ou senha incorretos."));
      } else if (res.error === "service_unavailable") {
        setServerError(t(MENSAGEM_DE_INSTABILIDADE));
      } else if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Erro inesperado. Tente novamente."));
      }
    });
  };

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {/* `acesso-cascata` escalona a entrada dos filhos em 50ms. Vale para os
          filhos DIRETOS, então o botão e o erro entram na conta junto com os
          campos — que é o desejado: a cascata percorre o formulário inteiro. */}
      <div className="acesso-cascata space-y-4">
        <CampoDeAcesso
          id="email"
          rotulo="Email"
          type="email"
          autoComplete="email"
          icone={<EnvelopeSimpleIcon size={20} weight="duotone" />}
          autoFocus
          erro={errors.email ? t(errors.email.message ?? "") : undefined}
          {...register("email")}
        />
        <CampoDeAcesso
          id="password"
          rotulo={t("Senha")}
          type="password"
          autoComplete="current-password"
          icone={<LockSimpleIcon size={20} weight="duotone" />}
          revelavel
          erro={errors.password ? t(errors.password.message ?? "") : undefined}
          {...register("password")}
        />
        {serverError && (
          <div
            className="acesso-erro rounded-[10px] border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
            role="alert"
          >
            {serverError}
          </div>
        )}
        <Button type="submit" size="lg" className="h-[3.25rem] w-full rounded-[14px] text-[15px] font-semibold shadow-md" disabled={isPending}>
          {isPending ? t("Entrando...") : t("Entrar")}
        </Button>
      </div>
    </form>
  );
}
