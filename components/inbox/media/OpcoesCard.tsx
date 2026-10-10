"use client";

import { useT } from "@/hooks/i18n/useT";
import { opcoesDaMetadata, respostaInterativaDaMetadata } from "@/lib/channels/opcoes-interativas";
import type { Message } from "@/lib/types/messaging";
import { ChartBar, CheckCircle, ListChecks } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * A enquete ou lista que NÓS mandamos, como o atendente a reconhece: a
 * pergunta, as opções, e — quando o cliente já tocou — qual ele escolheu.
 *
 * O corpo da linha guarda a mesma pergunta numerada (é o que a prévia e a busca
 * leem), mas mostrá-lo aqui faria a enquete parecer um texto que o cliente
 * recebeu numerado — o que não é verdade quando o canal desenhou as opções.
 */
export function OpcoesCard({ message }: { message: Message }) {
  const t = useT();
  const opcoes = opcoesDaMetadata(message.metadata);
  if (!opcoes) {
    return <p className="whitespace-pre-wrap break-words leading-snug">{message.body}</p>;
  }
  const escolha = (message.metadata as Record<string, unknown> | null)?.escolha as
    | { opcao_id?: string | null; opcao_label?: string }
    | undefined;
  const Icone = opcoes.formato === "enquete" ? ChartBar : ListChecks;

  return (
    <div className="flex min-w-[200px] max-w-[280px] flex-col gap-1.5" data-testid="cartao-de-opcoes">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        <Icone size={12} weight="duotone" aria-hidden />
        {opcoes.formato === "enquete" ? t("Enquete") : t("Lista de opções")}
      </span>
      <p className="whitespace-pre-wrap break-words font-medium leading-snug">{opcoes.pergunta}</p>
      <ul className="flex flex-col gap-1">
        {opcoes.opcoes.map((o) => {
          const escolhida = escolha?.opcao_id === o.id || escolha?.opcao_label === o.label;
          return (
            <li
              key={o.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-current/20 bg-background/10 px-2 py-1 text-sm",
                escolhida && "border-current/60 bg-background/25 font-medium",
              )}
            >
              {escolhida ? <CheckCircle size={14} weight="fill" aria-hidden /> : null}
              <span className="min-w-0 break-words">{o.label}</span>
            </li>
          );
        })}
      </ul>
      <span className="text-[11px] opacity-75">
        {escolha?.opcao_label
          ? `${t("O cliente escolheu:")} ${escolha.opcao_label}`
          : t("Esperando o cliente escolher")}
      </span>
    </div>
  );
}

/**
 * O selo da RESPOSTA: o cliente não digitou isto, tocou numa opção. Sem o selo,
 * "Financeiro" sozinho na conversa parece uma palavra solta.
 */
export function SeloDeEscolha({ message }: { message: Message }) {
  const t = useT();
  const resposta = respostaInterativaDaMetadata(message.metadata);
  if (!resposta || message.direction !== "inbound") return null;
  const onde =
    resposta.formato === "enquete"
      ? t("Tocou na enquete")
      : resposta.formato === "lista"
        ? t("Escolheu na lista")
        : t("Tocou no botão");
  return (
    <span
      className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80"
      title={resposta.pergunta ?? undefined}
      data-testid="selo-de-escolha"
    >
      <CheckCircle size={10} weight="duotone" aria-hidden />
      {onde}
    </span>
  );
}
