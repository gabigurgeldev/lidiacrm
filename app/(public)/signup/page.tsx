import Link from "next/link";
import { cookies } from "next/headers";

import { SignupForm, type IndicacaoDoSignup } from "@/components/auth/SignupForm";
import { backofficeLigado, normalizarCodigo, precoComDesconto, validarCodigo } from "@/lib/backoffice/saida";
import { branding } from "@/lib/branding";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { cobrancaLigada } from "@/lib/billing/asaas";
import { env } from "@/lib/env";

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
  searchParams: Promise<{ invite?: string; ref?: string }>;
}) {
  const { invite, ref } = await searchParams;
  const payload = invite ? verifyInviteToken(invite) : null;
  const convite = invite && payload ? { token: invite, email: payload.email } : undefined;
  const conviteExpirado = Boolean(invite) && !payload;
  const indicacao = convite ? undefined : await indicacaoDaVisita(ref);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);
  // Só o ENDEREÇO do remetente (sem o nome de exibição): é o que a pessoa
  // procura na caixa de spam. Vazio = a tela não cita remetente nenhum.
  const remetente = (env.EMAIL_FROM.trim() || env.RESEND_FROM_EMAIL.trim()).replace(/^.*<([^>]+)>\s*$/, "$1");

  return (
    // Mesmo contrato de `login/page.tsx`: o nome da marca saiu da tela, e este
    // atributo é o que mantém a resolução do `.env` observável para a spec que
    // a cruza com o título da aba. Ver o comentário longo lá.
    <div className="group/cadastro space-y-6" data-marca-do-ambiente={branding().name}>
      {/* Some quando a tela de "confirme seu e-mail" aparece — ela tem o próprio título. */}
      <div className="space-y-2 text-center group-has-[[data-cadastro-enviado]]/cadastro:hidden">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-text">
          {t("Criar conta")}
        </h1>
        <p className="text-sm text-text-muted">
          {convite
            ? t("Crie sua senha para entrar na empresa que te convidou")
            : cobrancaLigada()
              ? `${t("Teste grátis por")} ${env.COBRANCA_DIAS_TRIAL} ${t("dias, sem cartão. Você confirma pelo e-mail e já começa.")}`
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

      <SignupForm convite={convite} remetente={remetente || undefined} indicacao={indicacao} />

      <p className="border-t border-border pt-3 text-sm text-text-muted group-has-[[data-cadastro-enviado]]/cadastro:hidden">
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

/**
 * `?ref=CODIGO` (link do afiliado no Back Office) ou o cookie `bo_ref` de uma
 * visita anterior. Pergunta ao Back Office para mostrar o desconto ANTES do
 * envio; código que o Back Office recusa some da tela em vez de virar erro.
 */
async function indicacaoDaVisita(ref: string | undefined): Promise<IndicacaoDoSignup | undefined> {
  if (!backofficeLigado()) return undefined;
  const daUrl = normalizarCodigo(ref);
  const codigo = daUrl ?? normalizarCodigo((await cookies()).get("bo_ref")?.value);
  if (!codigo) return undefined;
  const v = await validarCodigo(codigo);
  if (v.estado === "invalido") return undefined;
  const descontoBps = v.estado === "valido" ? v.descontoBps : null;
  return {
    codigo,
    daUrl: Boolean(daUrl),
    nomeAfiliado: v.estado === "valido" ? v.nomeAfiliado : null,
    descontoPct: descontoBps ? descontoBps / 100 : null,
    precoCheioCentavos: env.COBRANCA_VALOR_CENTAVOS,
    precoFinalCentavos: precoComDesconto(env.COBRANCA_VALOR_CENTAVOS, descontoBps),
  };
}
