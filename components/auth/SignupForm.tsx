"use client";

import { useForm, type Resolver } from "react-hook-form";
import {
  ArrowCounterClockwiseIcon,
  BuildingOfficeIcon,
  EnvelopeSimpleIcon,
  EnvelopeSimpleOpenIcon,
  LockSimpleIcon,
  ShieldCheckIcon,
  TagIcon,
  UserIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState, useTransition } from "react";

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
import { reenviarConfirmacao } from "@/app/actions/auth/reenviarConfirmacao";

/**
 * Convite em curso: a conta está sendo criada para ACEITAR um convite, não para
 * abrir uma empresa. Muda a tela — somem os campos da empresa (ela já existe;
 * pedir seria mandar a pessoa batizar a organização de outra gente) e o e-mail
 * fica travado no do convite.
 */
export interface ConviteDoSignup {
  token: string;
  email: string;
}

/**
 * Indicação de um afiliado do Back Office (link `/r/CODIGO/...` → `?ref=`).
 * O servidor já perguntou ao Back Office ao montar a tela; `descontoPct` null =
 * não deu para confirmar agora (o código segue e é conferido de novo no envio).
 */
export interface IndicacaoDoSignup {
  codigo: string;
  /** Veio na URL agora (grava o cookie) ou de um cookie de visita anterior. */
  daUrl: boolean;
  nomeAfiliado: string | null;
  descontoPct: number | null;
  precoCheioCentavos: number;
  precoFinalCentavos: number;
}

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Máscara de exibição do WhatsApp: (11) 98765-4321. O servidor guarda só dígitos. */
function mascararWhatsapp(bruto: string): string {
  const d = bruto.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** O GoTrue aceita um reenvio por minuto por endereço. */
const ESPERA_DO_REENVIO_S = 60;

export function SignupForm({
  convite,
  remetente,
  indicacao,
}: {
  convite?: ConviteDoSignup;
  indicacao?: IndicacaoDoSignup;
  /** Endereço que envia a confirmação — para a pessoa saber o que procurar. */
  remetente?: string;
}) {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [comCodigo, setComCodigo] = useState(Boolean(indicacao));

  // O link do afiliado vale por 90 dias: quem chega pelo link, sai e volta
  // depois pelo endereço direto continua indicado.
  useEffect(() => {
    if (!indicacao?.daUrl) return;
    document.cookie = `bo_ref=${indicacao.codigo}; Path=/; Max-Age=${90 * 24 * 60 * 60}; SameSite=Lax${
      location.protocol === "https:" ? "; Secure" : ""
    }`;
  }, [indicacao]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<SignupInput>({
    // O formulário tem UM tipo e DOIS contratos: no modo convite os campos da
    // empresa não são renderizados, e exigi-los bloquearia o envio de campos que
    // a pessoa não pode ver. O resolver troca; o tipo do form continua o largo.
    resolver: (convite
      ? zodResolver(signupComConviteSchema)
      : zodResolver(signupSchema)) as Resolver<SignupInput>,
    defaultValues: {
      full_name: "",
      org_name: "",
      whatsapp: "",
      email: convite?.email ?? "",
      password: "",
      password_confirm: "",
      aceite_termos: false,
      codigo_indicacao: indicacao?.codigo ?? "",
    },
  });

  // `watch` de UM campo só re-renderiza por esse campo — ver o medidor de força.
  const senha = watch("password") ?? "";
  const whatsappField = register("whatsapp");

  const onSubmit = (values: SignupInput) => {
    setServerError(null);
    startTransition(async () => {
      // No modo convite o e-mail do formulário é readonly, e readonly no
      // cliente não vale nada: quem confere de novo é o servidor.
      const entrada: SignupInput | SignupComConviteInput = convite
        ? { email: convite.email, password: values.password, password_confirm: values.password_confirm }
        : values;
      // Com a confirmação de e-mail desligada no Auth, a action já entra no CRM
      // por redirect e nada volta para cá.
      const res = await signUp(entrada, convite?.token);
      if (res.ok) {
        setSentTo(values.email);
        return;
      }
      if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error" && res.details?.codigo_indicacao) {
        setError("codigo_indicacao", { message: "Código de indicação inválido" });
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Não foi possível criar a conta. Tente novamente."));
      }
    });
  };

  if (sentTo) {
    return <ConfirmeSeuEmail email={sentTo} remetente={remetente} onTrocarEmail={() => setSentTo(null)} />;
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="acesso-cascata space-y-4">
        {!convite && (
          <>
            <CampoDeAcesso
              id="full_name"
              rotulo={t("Seu nome")}
              type="text"
              autoComplete="name"
              icone={<UserIcon size={20} weight="duotone" />}
              autoFocus
              erro={errors.full_name ? t(errors.full_name.message ?? "") : undefined}
              {...register("full_name")}
            />
            <CampoDeAcesso
              id="org_name"
              rotulo={t("Nome da empresa")}
              type="text"
              autoComplete="organization"
              icone={<BuildingOfficeIcon size={20} weight="duotone" />}
              erro={errors.org_name ? t(errors.org_name.message ?? "") : undefined}
              {...register("org_name")}
            />
            <CampoDeAcesso
              id="whatsapp"
              rotulo={t("WhatsApp")}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              icone={<WhatsappLogoIcon size={20} weight="duotone" />}
              erro={errors.whatsapp ? t(errors.whatsapp.message ?? "") : undefined}
              {...whatsappField}
              onChange={(e) => {
                setValue("whatsapp", mascararWhatsapp(e.target.value), { shouldValidate: Boolean(errors.whatsapp) });
              }}
            />
          </>
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
        {!convite &&
          (comCodigo ? (
            <div className="space-y-1.5">
              <CampoDeAcesso
                id="codigo_indicacao"
                rotulo={t("Código de indicação (opcional)")}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                icone={<TagIcon size={20} weight="duotone" />}
                erro={errors.codigo_indicacao ? t(errors.codigo_indicacao.message ?? "") : undefined}
                {...register("codigo_indicacao")}
              />
              {indicacao?.descontoPct ? (
                <p data-indicacao-desconto className="text-sm leading-snug text-text-muted">
                  {indicacao.nomeAfiliado ? (
                    <>
                      {t("Indicação de")} <strong className="text-text">{indicacao.nomeAfiliado}</strong>:{" "}
                    </>
                  ) : null}
                  <strong className="text-text">
                    {indicacao.descontoPct}% {t("de desconto")}
                  </strong>{" "}
                  {t("na mensalidade")} — <s>{brl(indicacao.precoCheioCentavos)}</s>{" "}
                  <strong className="text-text">{brl(indicacao.precoFinalCentavos)}</strong>
                  {t("/mês")}.
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setComCodigo(true)}
              className="text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text"
            >
              {t("Tenho um código de indicação")}
            </button>
          ))}
        {!convite && (
          <div className="space-y-1.5">
            <label htmlFor="aceite_termos" className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-text-muted">
              <input
                id="aceite_termos"
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[5px] border-border-strong accent-[var(--color-accent)]"
                aria-invalid={Boolean(errors.aceite_termos)}
                aria-describedby={errors.aceite_termos ? "aceite_termos-erro" : undefined}
                {...register("aceite_termos")}
              />
              <span>
                {t("Li e aceito os")}{" "}
                <a href="/legal/terms" target="_blank" rel="noreferrer" className="font-medium text-text underline underline-offset-4">
                  {t("Termos de uso")}
                </a>{" "}
                {t("e a")}{" "}
                <a href="/legal/privacy" target="_blank" rel="noreferrer" className="font-medium text-text underline underline-offset-4">
                  {t("Política de privacidade")}
                </a>
                .
              </span>
            </label>
            {errors.aceite_termos && (
              <p id="aceite_termos-erro" className="pl-[30px] text-xs text-error">
                {t(errors.aceite_termos.message ?? "")}
              </p>
            )}
          </div>
        )}
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

/**
 * A tela depois do "Criar conta". É o momento em que mais gente desiste: o
 * e-mail demora, cai no spam, e a pessoa não sabe o que procurar. Por isso ela
 * diz o remetente, manda olhar Spam e Promoções e oferece o reenvio — com a
 * espera de 60s que o próprio Auth impõe, visível no botão.
 *
 * `data-cadastro-enviado` esconde o título "Criar conta" da página
 * (`app/(public)/signup/page.tsx`), que é server component.
 */
function ConfirmeSeuEmail({
  email,
  remetente,
  onTrocarEmail,
}: {
  email: string;
  remetente?: string;
  onTrocarEmail: () => void;
}) {
  const t = useT();
  const [espera, setEspera] = useState(ESPERA_DO_REENVIO_S);
  const [reenviando, startReenvio] = useTransition();
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const id = window.setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [espera]);

  const reenvioBloqueado = espera > 0 || reenviando;

  const reenviar = () => {
    setAviso(null);
    startReenvio(async () => {
      const r = await reenviarConfirmacao(email);
      if (r.ok) {
        setAviso({ tipo: "ok", texto: t("Pronto! Enviamos um novo link. Confira de novo a caixa de entrada.") });
        setEspera(ESPERA_DO_REENVIO_S);
      } else {
        setAviso({ tipo: "erro", texto: t("Muitas tentativas. Aguarde alguns minutos e tente de novo.") });
        setEspera(ESPERA_DO_REENVIO_S);
      }
    });
  };

  return (
    <div data-cadastro-enviado className="acesso-cascata space-y-6 text-center" role="status" aria-live="polite">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
        <EnvelopeSimpleOpenIcon size={34} weight="duotone" />
      </div>

      <div className="space-y-2">
        <h1 className="text-balance text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-text">
          {/* Hífen inseparável: no celular o título quebrava em "e-" / "mail". */}
          {t("Falta só confirmar seu e-mail").replace("e-mail", "e‑mail")}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">
          {t("Enviamos um link de confirmação para")}
          <br />
          <strong className="break-all text-base text-text">{email}</strong>
        </p>
      </div>

      <ol className="space-y-3 rounded-[14px] border border-border bg-surface-elevated p-4 text-left text-sm text-text">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">1</span>
          <span>{t("Abra o e-mail que acabamos de enviar.")}</span>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">2</span>
          <span>
            {t("Clique em")} <strong>{t("Confirmar e entrar")}</strong>{" "}
            {t("— você cai direto no sistema, com sua empresa pronta.")}
          </span>
        </li>
      </ol>

      <div className="flex gap-3 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3 text-left text-sm text-text">
        <WarningCircleIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-warning" />
        <p className="leading-relaxed">
          <strong>{t("Não chegou em 2 minutos?")}</strong>{" "}
          {t("Olhe as pastas Spam, Lixo eletrônico e Promoções.")}
          {remetente && (
            <>
              {" "}
              {t("O remetente é")} <span className="break-all font-medium">{remetente}</span>.
            </>
          )}
        </p>
      </div>

      {aviso && (
        <p
          role={aviso.tipo === "erro" ? "alert" : undefined}
          className={
            aviso.tipo === "ok"
              ? "rounded-[10px] border border-accent/30 bg-accent-soft px-3.5 py-2.5 text-sm text-text"
              : "rounded-[10px] border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
          }
        >
          {aviso.texto}
        </p>
      )}

      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12 w-full rounded-[14px] text-[15px] font-semibold"
          disabled={reenvioBloqueado}
          title={reenvioBloqueado ? t("Aguarde para reenviar — o e-mail pode levar alguns minutos.") : undefined}
          onClick={reenviar}
        >
          <ArrowCounterClockwiseIcon size={18} weight="bold" />
          {reenviando
            ? t("Reenviando...")
            : espera > 0
              ? `${t("Reenviar e-mail em")} ${espera}s`
              : t("Reenviar e-mail")}
        </Button>
        <button
          type="button"
          onClick={onTrocarEmail}
          className="text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text"
        >
          {t("Digitei o e-mail errado")}
        </button>
      </div>
    </div>
  );
}
