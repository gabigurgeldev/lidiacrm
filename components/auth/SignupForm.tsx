"use client";

import { useForm, type Resolver } from "react-hook-form";
import { BuildingOfficeIcon, EnvelopeSimpleIcon, LockSimpleIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import {
  signupSchema,
  signupComConviteSchema,
  type SignupInput,
  type SignupComConviteInput,
} from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { CampoDeAcesso, ForcaDaSenha } from "@/components/auth/CampoDeAcesso";
import { signUp } from "@/app/actions/auth/signUp";

/**
 * Convite em curso: a conta está sendo criada para ACEITAR um convite, não para
 * abrir uma empresa. Muda duas coisas na tela — some o campo "Nome da empresa"
 * (a empresa já existe; pedir seria mandar a pessoa batizar a organização de
 * outra gente) e o e-mail fica travado no do convite.
 */
export interface ConviteDoSignup {
  token: string;
  email: string;
}

export function SignupForm({ convite }: { convite?: ConviteDoSignup }) {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignupInput>({
    // O formulário tem UM tipo e DOIS contratos: no modo convite o campo de
    // empresa não é renderizado, e exigi-lo bloquearia o envio de um campo que
    // a pessoa não pode ver. O resolver troca; o tipo do form continua o largo,
    // e `org_name` simplesmente não é enviado ao servidor nesse modo.
    resolver: (convite
      ? zodResolver(signupComConviteSchema)
      : zodResolver(signupSchema)) as Resolver<SignupInput>,
    defaultValues: {
      org_name: "",
      email: convite?.email ?? "",
      password: "",
      password_confirm: "",
    },
  });

  // O medidor de força precisa do valor a cada tecla, e `watch` de UM campo só
  // re-renderiza por esse campo. `watch()` sem argumento assinaria o formulário
  // inteiro e faria o nome da empresa redesenhar a barra de senha.
  const senha = watch("password") ?? "";

  const onSubmit = (values: SignupInput) => {
    setServerError(null);
    startTransition(async () => {
      // No modo convite o e-mail do formulário é readonly, e readonly no
      // cliente não vale nada: quem confere de novo é o servidor.
      const entrada: SignupInput | SignupComConviteInput = convite
        ? { email: convite.email, password: values.password, password_confirm: values.password_confirm }
        : values;
      const res = await signUp(entrada, convite?.token);
      if (res.ok) {
        setSentTo(values.email);
        return;
      }
      if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Não foi possível criar a conta. Tente novamente."));
      }
    });
  };

  if (sentTo) {
    return (
      <div
        className="acesso-erro space-y-2 rounded-[12px] border border-border bg-surface-elevated px-4 py-6 text-center"
        role="status"
      >
        <p className="text-sm font-medium text-text">{t("Confirme seu e-mail")}</p>
        <p className="text-sm text-text-muted">
          {t("Enviamos um link de confirmação para")} <strong className="text-text">{sentTo}</strong>.{" "}
          {t("Abra o e-mail e clique no link para ativar sua conta.")}
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="acesso-cascata space-y-4">
        {!convite && (
          <CampoDeAcesso
            id="org_name"
            rotulo={t("Nome da empresa")}
            type="text"
            autoComplete="organization"
            icone={<BuildingOfficeIcon size={20} weight="duotone" />}
            autoFocus
            erro={errors.org_name ? t(errors.org_name.message ?? "") : undefined}
            {...register("org_name")}
          />
        )}
        <CampoDeAcesso
          id="email"
          rotulo="Email"
          type="email"
          autoComplete="email"
          icone={<EnvelopeSimpleIcon size={20} weight="duotone" />}
          // O convite vale para UM endereço. Deixar editável convidaria a
          // trocar e receber "email_divergente" depois de preencher tudo.
          readOnly={Boolean(convite)}
          erro={errors.email ? t(errors.email.message ?? "") : undefined}
          {...register("email")}
        />
        <CampoDeAcesso
          id="password"
          rotulo={t("Senha")}
          type="password"
          autoComplete="new-password"
          icone={<LockSimpleIcon size={20} weight="duotone" />}
          revelavel
          acessorio={senha.length > 0 ? <ForcaDaSenha senha={senha} /> : undefined}
          erro={errors.password ? t(errors.password.message ?? "") : undefined}
          {...register("password")}
        />
        <CampoDeAcesso
          id="password_confirm"
          rotulo={t("Confirmar senha")}
          type="password"
          autoComplete="new-password"
          icone={<ShieldCheckIcon size={20} weight="duotone" />}
          revelavel
          erro={errors.password_confirm ? t(errors.password_confirm.message ?? "") : undefined}
          {...register("password_confirm")}
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
          {isPending ? t("Criando conta...") : t("Criar conta")}
        </Button>
      </div>
    </form>
  );
}
