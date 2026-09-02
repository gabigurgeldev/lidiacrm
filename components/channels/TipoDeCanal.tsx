"use client";

import { useT } from "@/hooks/i18n/useT";
import { Plugs, QrCode, SealCheck, WhatsappLogo } from "@/lib/ui/icons";
import {
  EXPLICACAO_DO_TIPO,
  EXPLICACAO_VIA_PARCEIRO,
  ROTULO_DO_TIPO,
  conexaoNaTela,
} from "@/lib/channels/tipo-de-conexao";
import { cn } from "@/lib/utils";

/**
 * COMO ESTE NÚMERO FOI LIGADO — por QR ou canal oficial, direto ou por parceiro.
 *
 * ⚠️ ESTE ARQUIVO NUNCA VÊ O NOME DO PROVIDER, e não é preciosismo: a doutrina
 * `restricao-de-canal` reserva o nome a `lib/channels/`, e `pnpm lint:channels`
 * reprova arquivo novo fora de lá que o cite. Quem traduz é
 * `lib/channels/tipo-de-conexao.ts`; aqui só se desenha o resultado — inclusive a
 * marca do parceiro, que chega pronta como dado.
 *
 * `desconhecido` NÃO desenha nada. Um clone antigo cujo banco não tem a coluna
 * `provider` recebe a lista sem ela de propósito (ver `consultaTolerante`), e
 * chutar um selo ali afirmaria a regra de envio ERRADA — o canal oficial tem
 * janela de 24h e o número por QR não tem. Selo errado sobre isso é pior que
 * selo nenhum.
 */
export type VarianteDoSelo = "selo" | "linha" | "bolha" | "cartao";

export function TipoDeCanal({
  provider,
  modo,
  /**
   * `selo` para o seletor e a lista; `linha` para o cabeçalho da conversa;
   * `bolha` para a meta de cada mensagem (só ícones, sem rótulo); `cartao` para a
   * página de Conexões, onde o selo tem espaço e carrega o nome do parceiro.
   */
  variante = "selo",
  className,
}: {
  provider: string | null | undefined;
  /** `channel_sessions.provider_mode` — só os canais de dupla modalidade usam. */
  modo?: string | null;
  variante?: VarianteDoSelo;
  className?: string;
}) {
  const t = useT();
  const conexao = conexaoNaTela(provider, modo);
  if (conexao.transporte === "desconhecido") return null;

  const { transporte, viaParceiro, parceiro } = conexao;
  const rotulo = t(ROTULO_DO_TIPO[transporte]);
  const explicacaoBase = t(
    (viaParceiro ? EXPLICACAO_VIA_PARCEIRO : EXPLICACAO_DO_TIPO)[transporte],
  );
  // A marca do parceiro entra no `title` por concatenação e não por chave de
  // dicionário: nome próprio não se traduz, e uma chave por marca obrigaria a
  // editar o dicionário toda vez que um parceiro novo entrasse.
  const explicacao = parceiro ? `${explicacaoBase} (${parceiro})` : explicacaoBase;

  // O logo do WhatsApp é a marca de VERDADE (pedido explícito) e diz "isto é um
  // número de WhatsApp"; o segundo ícone diz QUAL dos dois tipos; o terceiro, que
  // só aparece quando há intermediário, diz que a conexão não é nossa. Três
  // símbolos porque são três perguntas — um só teria de significar todas.
  const Marca = transporte === "oficial" ? SealCheck : QrCode;
  const tamanho = variante === "bolha" ? 10 : variante === "cartao" ? 14 : 12;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 leading-none text-text-muted",
        variante === "bolha" ? "text-[10px]" : "text-[11px]",
        (variante === "selo" || variante === "cartao") &&
          "rounded-full border border-border px-1.5 py-0.5 tabular-nums",
        variante === "cartao" && "text-xs",
        className,
      )}
      title={explicacao}
      data-testid="tipo-de-canal"
      data-tipo={transporte}
      data-via-parceiro={viaParceiro ? "sim" : "nao"}
    >
      <WhatsappLogo
        size={tamanho}
        weight="fill"
        aria-hidden
        // Verde SÓ aqui, e do token: é a marca do WhatsApp, não a do produto.
        // No canal oficial ela divide a linha com o selo, então fica neutra para
        // os ícones não brigarem por atenção.
        className={transporte === "qr" ? "text-success" : undefined}
      />
      <Marca size={tamanho} aria-hidden />
      {viaParceiro && <Plugs size={tamanho} aria-hidden />}
      {/* Na bolha o rótulo sai: ele se repetiria em cada mensagem da thread e
          empurraria a hora para fora da linha. Os ícones e o `title` bastam, e a
          `aria-label` mantém o leitor de tela informado sem custo visual. */}
      {variante === "bolha" ? (
        <span className="sr-only">{explicacao}</span>
      ) : (
        <span className="truncate">
          {rotulo}
          {variante === "cartao" && parceiro ? ` · ${parceiro}` : ""}
        </span>
      )}
    </span>
  );
}
