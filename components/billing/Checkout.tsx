"use client";
/**
 * O checkout da assinatura — PIX ou cartão, com a cara do sistema.
 *
 * Montado em `/assinatura` (tela cheia, inclusive para quem está bloqueado) e
 * em Configurações › Assinatura (trocar cartão, pagar antes, mudar para PIX).
 *
 * ═══ Por que a tela espera o PIX em vez de confiar no botão ═══
 * PIX é pago FORA daqui, no app do banco. O que prova o pagamento é o webhook
 * do Asaas chegar e gravar a cobrança como paga. A tela consulta o status a
 * cada 3s e só diz "pagamento confirmado" quando a cobrança DAQUELE QR aparece
 * paga — nunca por tempo, nunca por clique.
 *
 * ⚠️ Os campos do cartão vivem só no estado deste componente e vão direto no
 * corpo do POST. Nada é gravado no navegador (sem localStorage, sem autofill
 * de terceiros além do que o próprio navegador oferece).
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import {
  STATUS_PAGOS_NA_TELA,
  useCheckout,
  useStatusDaAssinatura,
} from "@/hooks/useAssinatura";
import type { ResultadoDoCheckout } from "@/lib/billing/checkout";
import {
  bandeiraDoNumero,
  cartaoSchema,
  soDigitos,
  titularSchema,
} from "@/lib/billing/validacao";
import { cn } from "@/lib/utils";

type Metodo = "PIX" | "CREDIT_CARD";

// ---------------------------------------------------------------------------
// Máscaras
// ---------------------------------------------------------------------------

function mascaraDocumento(v: string): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
function mascaraTelefone(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}
const mascaraCep = (v: string) => soDigitos(v).slice(0, 8).replace(/(\d{5})(\d{1,3})$/, "$1-$2");
const mascaraCartao = (v: string) => soDigitos(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
const mascaraValidade = (v: string) => soDigitos(v).slice(0, 4).replace(/(\d{2})(\d{1,2})$/, "$1/$2");

export const reaisDe = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------------------------------------------------------------------
// Campo
// ---------------------------------------------------------------------------

function Campo({
  id,
  rotulo,
  erro,
  children,
  className,
}: {
  id: string;
  rotulo: string;
  erro?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </Label>
      {children}
      {erro && (
        <p className="text-xs text-destructive" role="alert" id={`${id}-erro`}>
          {erro}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resultado: PIX aguardando / sucesso
// ---------------------------------------------------------------------------

function EsperandoPix({
  r,
  onVoltar,
  onPago,
}: {
  r: Extract<ResultadoDoCheckout, { tipo: "pix" }>;
  onVoltar: () => void;
  onPago: () => void;
}) {
  const t = useT();
  const { data } = useStatusDaAssinatura(3000);
  const [copiado, setCopiado] = useState(false);

  const pago = useMemo(
    () =>
      !!data?.cobrancas.some(
        (c) => c.asaas_payment_id === r.pagamentoId && STATUS_PAGOS_NA_TELA.has(c.status),
      ),
    [data, r.pagamentoId],
  );
  useEffect(() => {
    if (pago) onPago();
  }, [pago, onPago]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(r.copiaECola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* navegador sem permissão de clipboard: o texto continua selecionável */
    }
  }

  return (
    <div className="grid gap-5" data-testid="pix-aguardando">
      <div className="text-center">
        <p className="text-sm font-semibold">{t("Escaneie o QR Code no app do seu banco")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {reaisDe(r.valorCentavos)}
          {r.expiraEm ? ` · ${t("válido até")} ${new Date(r.expiraEm).toLocaleString("pt-BR")}` : ""}
        </p>
      </div>
      <div className="mx-auto rounded-2xl border bg-white p-3 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI do Asaas */}
        <img
          src={`data:image/png;base64,${r.qrBase64}`}
          alt={t("QR Code PIX")}
          width={220}
          height={220}
          className="h-[220px] w-[220px]"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pix-copia" className="text-xs text-muted-foreground">
          {t("Ou copie o código PIX")}
        </Label>
        <div className="flex gap-2">
          <Input id="pix-copia" readOnly value={r.copiaECola} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" onClick={copiar} data-testid="pix-copiar">
            {copiado ? t("Copiado!") : t("Copiar")}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm" role="status">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        {t("Aguardando o pagamento — esta tela atualiza sozinha.")}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onVoltar}>
        {t("Voltar e escolher outra forma")}
      </Button>
    </div>
  );
}

function Sucesso({ titulo, texto, onContinuar }: { titulo: string; texto: string; onContinuar: () => void }) {
  const t = useT();
  return (
    <div className="grid place-items-center gap-4 py-8 text-center" data-testid="pagamento-confirmado">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <p className="text-lg font-semibold">{titulo}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      <Button onClick={onContinuar} data-testid="continuar-para-o-app">
        {t("Ir para o CRM")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export function Checkout({
  emailInicial,
  destinoDepois = "/app",
  modo = "assinar",
}: {
  emailInicial?: string;
  destinoDepois?: string;
  /** "gerenciar" = em dia, trocando forma de pagamento; muda só os textos. */
  modo?: "assinar" | "gerenciar";
}) {
  const t = useT();
  const router = useRouter();
  const checkout = useCheckout();

  const [metodo, setMetodo] = useState<Metodo>("PIX");
  const [titular, setTitular] = useState({
    nome: "",
    cpfCnpj: "",
    email: emailInicial ?? "",
    telefone: "",
    cep: "",
    numero: "",
  });
  const [cartao, setCartao] = useState({ numero: "", nome: "", validade: "", cvv: "" });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDoCheckout | null>(null);
  const [pagoPix, setPagoPix] = useState(false);

  const bandeira = bandeiraDoNumero(cartao.numero);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    const [mes = "", ano = ""] = cartao.validade.split("/");
    const payload = {
      metodo,
      titular,
      ...(metodo === "CREDIT_CARD"
        ? { cartao: { numero: cartao.numero, nome: cartao.nome, mes, ano, cvv: cartao.cvv } }
        : {}),
    };

    const novos: Record<string, string> = {};
    const rt = titularSchema.safeParse(titular);
    if (!rt.success) for (const i of rt.error.issues) novos[`titular.${String(i.path[0])}`] ??= t(i.message);
    if (metodo === "CREDIT_CARD") {
      const rc = cartaoSchema.safeParse(payload.cartao);
      if (!rc.success) for (const i of rc.error.issues) novos[`cartao.${String(i.path[0])}`] ??= t(i.message);
    }
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    checkout.mutate(payload as Parameters<typeof checkout.mutate>[0], {
      onSuccess: (r) => setResultado(r),
      onError: (err) => setErroGeral(err instanceof Error ? err.message : t("Não foi possível concluir agora.")),
    });
  }

  const ir = () => {
    router.push(destinoDepois);
    router.refresh();
  };

  if (pagoPix) {
    return (
      <Sucesso
        titulo={t("Pagamento confirmado!")}
        texto={t("Obrigado. O acesso está liberado.")}
        onContinuar={ir}
      />
    );
  }
  if (resultado?.tipo === "pix") {
    return <EsperandoPix r={resultado} onVoltar={() => setResultado(null)} onPago={() => setPagoPix(true)} />;
  }
  if (resultado?.tipo === "cartao_aprovado") {
    return (
      <Sucesso
        titulo={t("Pagamento aprovado!")}
        texto={t("Sua assinatura está ativa e o cartão fica cadastrado para as próximas mensalidades.")}
        onContinuar={ir}
      />
    );
  }
  if (resultado?.tipo === "cartao_agendado") {
    const quando = resultado.vencimento
      ? new Date(`${resultado.vencimento}T12:00:00Z`).toLocaleDateString("pt-BR")
      : null;
    return (
      <Sucesso
        titulo={t("Cartão cadastrado!")}
        texto={
          quando
            ? `${t("A cobrança será feita automaticamente em")} ${quando}.`
            : t("A cobrança será feita automaticamente no vencimento.")
        }
        onContinuar={ir}
      />
    );
  }
  if (resultado?.tipo === "metodo_atualizado") {
    return (
      <Sucesso
        titulo={t("Forma de pagamento atualizada!")}
        texto={t("As próximas mensalidades usam a forma escolhida.")}
        onContinuar={ir}
      />
    );
  }

  const erroDe = (k: string) => erros[k];
  const setT = (k: keyof typeof titular) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const bruto = e.target.value;
    const valor =
      k === "cpfCnpj" ? mascaraDocumento(bruto) : k === "telefone" ? mascaraTelefone(bruto) : k === "cep" ? mascaraCep(bruto) : bruto;
    setTitular((s) => ({ ...s, [k]: valor }));
  };

  return (
    <form onSubmit={enviar} className="grid gap-5" noValidate data-testid="checkout-form">
      {/* Forma de pagamento */}
      <div role="radiogroup" aria-label={t("Forma de pagamento")} className="grid grid-cols-2 gap-2">
        {(
          [
            { v: "PIX" as const, titulo: "PIX", sub: t("Aprovação na hora") },
            { v: "CREDIT_CARD" as const, titulo: t("Cartão de crédito"), sub: t("Cobrança automática todo mês") },
          ]
        ).map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={metodo === o.v}
            onClick={() => setMetodo(o.v)}
            data-testid={`metodo-${o.v}`}
            className={cn(
              "rounded-xl border px-4 py-3 text-left transition-all",
              metodo === o.v
                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                : "hover:border-foreground/30 hover:bg-muted/40",
            )}
          >
            <span className="block text-sm font-semibold">{o.titulo}</span>
            <span className="block text-xs text-muted-foreground">{o.sub}</span>
          </button>
        ))}
      </div>

      {/* Titular */}
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Dados de cobrança")}
        </legend>
        <Campo id="t-nome" rotulo={t("Nome completo ou razão social")} erro={erroDe("titular.nome")}>
          <Input id="t-nome" autoComplete="name" value={titular.nome} onChange={setT("nome")} />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="t-doc" rotulo={t("CPF ou CNPJ")} erro={erroDe("titular.cpfCnpj")}>
            <Input id="t-doc" inputMode="numeric" value={titular.cpfCnpj} onChange={setT("cpfCnpj")} data-testid="t-doc" />
          </Campo>
          <Campo id="t-tel" rotulo={t("Celular")} erro={erroDe("titular.telefone")}>
            <Input id="t-tel" inputMode="tel" autoComplete="tel" value={titular.telefone} onChange={setT("telefone")} />
          </Campo>
        </div>
        <Campo id="t-email" rotulo={t("E-mail para a nota e os recibos")} erro={erroDe("titular.email")}>
          <Input id="t-email" type="email" autoComplete="email" value={titular.email} onChange={setT("email")} />
        </Campo>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Campo id="t-cep" rotulo={t("CEP")} erro={erroDe("titular.cep")}>
            <Input id="t-cep" inputMode="numeric" autoComplete="postal-code" value={titular.cep} onChange={setT("cep")} />
          </Campo>
          <Campo id="t-num" rotulo={t("Número")} erro={erroDe("titular.numero")}>
            <Input id="t-num" value={titular.numero} onChange={setT("numero")} />
          </Campo>
        </div>
      </fieldset>

      {/* Cartão */}
      {metodo === "CREDIT_CARD" && (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Cartão")}
          </legend>
          <Campo id="c-num" rotulo={t("Número do cartão")} erro={erroDe("cartao.numero")}>
            <div className="relative">
              <Input
                id="c-num"
                inputMode="numeric"
                autoComplete="cc-number"
                value={cartao.numero}
                onChange={(e) => setCartao((s) => ({ ...s, numero: mascaraCartao(e.target.value) }))}
                className="pr-24 font-mono tracking-wider"
                data-testid="c-num"
              />
              {bandeira !== "outra" && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {bandeira}
                </span>
              )}
            </div>
          </Campo>
          <Campo id="c-nome" rotulo={t("Nome impresso no cartão")} erro={erroDe("cartao.nome")}>
            <Input
              id="c-nome"
              autoComplete="cc-name"
              value={cartao.nome}
              onChange={(e) => setCartao((s) => ({ ...s, nome: e.target.value.toUpperCase() }))}
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="c-val" rotulo={t("Validade (MM/AA)")} erro={erroDe("cartao.mes") ?? erroDe("cartao.ano")}>
              <Input
                id="c-val"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM/AA"
                value={cartao.validade}
                onChange={(e) => setCartao((s) => ({ ...s, validade: mascaraValidade(e.target.value) }))}
              />
            </Campo>
            <Campo id="c-cvv" rotulo="CVV" erro={erroDe("cartao.cvv")}>
              <Input
                id="c-cvv"
                inputMode="numeric"
                autoComplete="cc-csc"
                type="password"
                value={cartao.cvv}
                onChange={(e) => setCartao((s) => ({ ...s, cvv: soDigitos(e.target.value).slice(0, 4) }))}
              />
            </Campo>
          </div>
        </fieldset>
      )}

      {erroGeral && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" data-testid="checkout-erro">
          {erroGeral}
          {metodo === "CREDIT_CARD" && (
            <button type="button" className="ml-2 font-semibold underline" onClick={() => setMetodo("PIX")}>
              {t("Pagar com PIX")}
            </button>
          )}
        </div>
      )}

      <Button type="submit" size="lg" disabled={checkout.isPending} data-testid="checkout-enviar" className="h-12 text-base">
        {checkout.isPending
          ? t("Processando...")
          : metodo === "PIX"
            ? t("Gerar QR Code PIX")
            : modo === "gerenciar"
              ? t("Salvar cartão")
              : t("Assinar com cartão")}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 118 0v3" />
        </svg>
        {t("Pagamento processado pelo Asaas. Os dados do cartão não ficam guardados no nosso sistema.")}
      </p>
    </form>
  );
}
