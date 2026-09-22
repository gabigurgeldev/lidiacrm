import Link from "next/link";

import { LoginForm } from "@/components/auth/LoginForm";
import { branding } from "@/lib/branding";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  // Fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider` do lado do
  // servidor (o cliente já tem o seu, montado em `app/(public)/layout.tsx`).
  // Quase nunca há sessão aqui (é a própria tela de entrar), mas resolve do
  // mesmo jeito por segurança — `user` opcional.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    // ⚠️ `data-marca-do-ambiente` NÃO é decoração e não pode ser removido sem
    // ler `tests/e2e/icone-da-marca.spec.ts`.
    //
    // O nome da marca era escrito em texto logo abaixo do "Entrar", e saiu a
    // pedido de quem é dono do produto: o logo acima já o diz. Mas aquele texto
    // carregava um contrato invisível — ele vinha de `branding()` (que lê o
    // `.env`) enquanto o título da aba vem de `generateMetadata` (que lê
    // `platform_branding` no banco), e a spec comparava os dois justamente para
    // pegar o caso de "trocaram o nome pela tela e a aba não acompanhou".
    //
    // Este atributo é o mesmo valor, pelo mesmo caminho, sem ocupar pixel. Ler
    // o `alt` do logo no lugar PARECE equivalente e não é: aquele sai de
    // `marcaDaSaida`, a mesma pilha do título — a spec passaria a comparar o
    // banco consigo mesmo e ficaria verde medindo nada.
    <div className="space-y-6" data-marca-do-ambiente={branding().name}>
      <div className="space-y-2 text-center">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-text">
          {t("Entrar")}
        </h1>
        <p className="text-sm text-text-muted">
          {t("Use o e-mail e a senha da sua conta para continuar.")}
        </p>
      </div>
      {reset === "success" && (
        <div
          className="acesso-erro rounded-[10px] border border-accent/30 bg-accent-soft px-3.5 py-2.5 text-sm text-text"
          role="status"
        >
          {t("Senha redefinida com sucesso. Entre com a nova senha.")}
        </div>
      )}
      {error === "link_invalido" && (
        <div
          className="acesso-erro rounded-[10px] border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
          role="alert"
        >
          {t("Link inválido ou expirado. Peça um novo em Recuperar senha ou refaça o cadastro.")}
        </div>
      )}
      {/*
        Os dois avisos abaixo chegaram por frentes diferentes e falam de erros
        diferentes — o merge os pôs no mesmo lugar, e ficar com um só apagaria um
        diagnóstico inteiro da tela de login.
      */}
      {error === "convite_invalido" && (
        <div
          className="acesso-erro rounded-[10px] border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas o convite não vale mais — ele expirou ou foi emitido para outro e-mail. Peça um novo a quem te convidou. Não criamos uma empresa nova para você, porque não era isso que você estava fazendo.",
          )}
        </div>
      )}
      {error === "template_padrao" && (
        <div
          className="acesso-erro rounded-[10px] border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
          role="alert"
        >
          {t(
            "Este link veio do modelo de e-mail padrão do Supabase, que não fecha o acesso nesta instalação — pedir outro link não resolve. Quem administra o sistema precisa configurar os e-mails de acesso (",
          )}
          <code>marca-emails.sh</code>
          {t(", no kit de instalação).")}
        </div>
      )}
      {error === "provisionamento" && (
        <div
          className="acesso-erro rounded-[10px] border border-error/30 bg-error-bg px-3.5 py-2.5 text-sm text-error"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas houve um erro ao preparar seu ambiente. Tente entrar novamente em instantes.",
          )}
        </div>
      )}
      <LoginForm next={next} />
      <div className="space-y-3 text-sm">
        <p>
          <Link
            href="/login/forgot"
            className="text-text-muted underline-offset-4 transition-colors duration-fast ease-out hover:text-text hover:underline"
          >
            {t("Esqueci minha senha")}
          </Link>
        </p>
        <p className="border-t border-border pt-3 text-text-muted">
          {t("Não tem conta?")}{" "}
          <Link
            href="/signup"
            className="font-semibold text-text underline underline-offset-4 decoration-border-strong transition-colors duration-fast ease-out hover:decoration-text"
          >
            {t("Criar conta")}
          </Link>
        </p>
      </div>
    </div>
  );
}
