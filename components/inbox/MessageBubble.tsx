"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { format } from "date-fns";
import { useT } from "@/hooks/i18n/useT";
import { ArrowBendUpLeft, Check, Checks, Robot, WarningOctagon } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Message } from "@/lib/types/messaging";
import { CitationButton } from "@/components/ai/CitationButton";
import { TipoDeCanal } from "@/components/channels/TipoDeCanal";
import { conexaoNaTela } from "@/lib/channels/tipo-de-conexao";
import { MediaRenderer } from "@/components/inbox/media/MediaRenderer";
import { ContactCard } from "@/components/inbox/media/ContactCard";
import {
  extractCitations,
  isAiGeneratedMessage,
} from "@/lib/ai/citations/types";

interface Props {
  message: Message;
  debugCitations?: boolean;
  /** Escolher esta mensagem para responder "em cima" dela. */
  onResponder?: (m: Message) => void;
  /** A mensagem citada por ESTA, quando houver — desenha o fio. */
  citada?: Message | null;
  /**
   * Esta é a primeira de um bloco do mesmo autor?
   *
   * ⚠️ É O QUE FAZ UMA PILHA DE RETÂNGULOS VIRAR UMA CONVERSA. Só a primeira do
   * bloco leva o rabo e o espaçamento cheio; as seguintes colam. Sem isso, dez
   * mensagens seguidas da mesma pessoa parecem dez interrupções — que é
   * exatamente como o inbox se lia antes.
   *
   * Default `true` porque uma bolha isolada (uma prévia, um teste) é sempre a
   * primeira do próprio bloco.
   */
  primeiraDoBloco?: boolean;
  /**
   * POR ONDE esta mensagem passou — o provider da sessão que a carregou, e a
   * modalidade dele quando houver mais de uma.
   *
   * ⚠️ CHEGA POR PROP, e isso é decisão de desempenho, não de gosto: a bolha
   * não pode consultar a lista de canais, porque uma thread longa montaria a
   * mesma consulta centenas de vezes. Quem resolve o mapa uma vez é o
   * `ChatThread`.
   *
   * `undefined` = não deu para descobrir (canal excluído sem fallback, resposta
   * antiga em cache). O selo simplesmente não aparece — afirmar a regra de envio
   * errada é pior que não afirmar nada.
   */
  canalProvider?: string | null;
  canalModo?: string | null;
}

function AckIndicator({ status, t }: { status: string; t: (texto: string) => string }) {
  if (status === "read") {
    return <Checks size={12} weight="bold" className="text-blue-400" aria-label={t("Lida")} />;
  }
  if (status === "delivered") {
    return <Checks size={12} weight="bold" className="text-current/70" aria-label={t("Entregue")} />;
  }
  if (status === "sent") {
    return <Check size={12} weight="bold" className="text-current/70" aria-label={t("Enviada")} />;
  }
  return null;
}

export function MessageBubble({
  message,
  debugCitations,
  onResponder,
  citada,
  primeiraDoBloco = true,
  canalProvider,
  canalModo,
}: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const isOutbound = message.direction === "outbound";
  const time = format(new Date(message.sent_at), "HH:mm", { locale: localeDaData });
  const isFailed = message.status === "failed";
  const hasMedia = Boolean(message.media_url || message.media_storage_path);
  const isContact = message.type === "contact";
  // Figurinha sem caption: sem moldura de bolha (padrão WhatsApp).
  const isBareSticker = hasMedia && message.type === "sticker" && !message.body;
  // Apagada pelo autor ("apagar para todos"). A linha continua no histórico —
  // sumir com ela deixaria a resposta seguinte respondendo ao nada —, mas o
  // texto não aparece: mostrá-lo seria expor justamente o que o cliente pediu
  // para tirar do ar.
  const apagada = Boolean(message.revoked_at);
  const editada = Boolean(message.edited_at) && !apagada;
  const aiGenerated = isAiGeneratedMessage(message.metadata);
  const citations = extractCitations(message.metadata);
  const showCitationButton =
    isOutbound && aiGenerated && (debugCitations ?? false);
  /**
   * A HORA DENTRO DA BOLHA, com o texto correndo em volta.
   *
   * É o detalhe que mais denuncia "não é WhatsApp": a hora numa linha própria
   * empurra a bolha para baixo em toda mensagem de duas palavras — "Que bom"
   * virava um retângulo de duas linhas.
   *
   * ⚠️ SÓ PARA TEXTO PURO, e cada exclusão foi pesada:
   *  - com MÍDIA, o metadado flutuaria sobre a imagem e precisaria de sombra
   *    própria para continuar legível — ou cairia em cima do botão do áudio;
   *  - com CITAÇÃO, a bolha tem um bloco no topo e a reserva no fim do texto
   *    abriria um buraco no meio;
   *  - APAGADA é uma frase do CRM narrando, não fala de ninguém: reservar
   *    espaço ali daria a ela um enquadramento que ela não pede.
   */
  const horaFlutuante =
    !hasMedia && !isContact && !apagada && !citada && Boolean(message.body?.trim());

  const senderLabel = (() => {
    if (!isOutbound) return null;
    if (message.sent_via === "ai") return "IA";
    return null;
  })();

  /**
   * O selo de canal é desenhado?
   *
   * A pergunta é feita AQUI e não só dentro do `TipoDeCanal` porque a bolha
   * precisa da resposta antes de renderizar: é ela que reserva a faixa da hora
   * flutuante (`data-com-selo`), e reservar espaço para um selo que não aparece
   * abriria um vão no fim de toda mensagem de canal desconhecido.
   */
  const temSeloDeCanal = conexaoNaTela(canalProvider, canalModo).transporte !== "desconhecido";

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-1 px-4",
        // O respiro entre BLOCOS é o dobro do respiro DENTRO de um bloco. É o
        // agrupamento inteiro: a mesma pessoa falando três vezes seguidas é um
        // parágrafo, não três turnos.
        primeiraDoBloco ? "pt-2" : "pt-0.5",
        isOutbound ? "justify-end" : "justify-start",
      )}
    >
      {/*
        RESPONDER — aparece ao passar o mouse, como no WhatsApp Web.
        Fica FORA da bolha para não disputar espaço com o texto, e do lado de
        dentro da conversa (à esquerda no que sai, à direita no que entra), que
        é onde a mão já está.

        `opacity` e não `hidden`: esconder de verdade faria o layout pular
        quando o mouse entra. Em telas de toque não há hover — por isso
        `focus-visible` também revela, e o teclado alcança.
      */}
      {onResponder && isOutbound && (
        <button
          type="button"
          onClick={() => onResponder(message)}
          aria-label={t("Responder a esta mensagem")}
          className={cn(
            "rounded p-1 text-muted-foreground transition-opacity hover:bg-muted",
            // VISÍVEL POR PADRÃO, e escondido só onde EXISTE hover.
            //
            // A primeira versão era `opacity-0` + `group-hover`, copiando o
            // WhatsApp Web. No celular isso deixa o botão invisível para
            // sempre: não há como passar o mouse, e `focus-visible` só chega
            // por teclado. Ou seja, a função sumia exatamente onde o dono
            // deste CRM mais atende.
            //
            // `@media (hover: hover)` pergunta pelo DISPOSITIVO, não pela
            // largura: um tablet largo com toque continua mostrando, e um
            // desktop estreito continua escondendo. Largura não é a pergunta.
            "opacity-100 [@media(hover:hover)]:opacity-0",
            "[@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <ArrowBendUpLeft size={14} />
        </button>
      )}
      <div
        // `data-lado` e `data-ponta` em vez de classes condicionais porque quem
        // desenha o rabo é um `::after` (app/globals.css, bloco "INBOX"), e
        // pseudo-elemento não existe no JSX. O rabo herda a cor da bolha com
        // `background-color: inherit` — repeti-la no CSS criaria uma segunda
        // fonte para a cor que o revendedor troca em runtime.
        data-lado={isOutbound ? "saida" : "entrada"}
        data-ponta={primeiraDoBloco && !isBareSticker ? "true" : "false"}
        // A faixa reservada para a hora flutuante cresce quando o selo entra
        // nela. Atributo e não classe porque quem calcula a reserva é o CSS
        // (`--bolha-reserva`), e a conta tem que ficar do lado de quem a usa.
        data-com-selo={temSeloDeCanal ? "true" : "false"}
        className={cn(
          // 65% e não 75%: numa coluna larga, uma bolha de três quartos da
          // largura deixa de parecer uma fala e passa a parecer um bloco de
          // texto. É a proporção que o WhatsApp usa.
          "max-w-[65%] text-sm",
          isBareSticker
            ? "px-0 py-0"
            : cn(
                "bolha px-2.5 py-1.5 shadow-sm",
                isOutbound
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-elevated text-foreground",
              ),
          isFailed && "border border-destructive",
        )}
      >
        {/*
          A CITAÇÃO, dentro da bolha e acima do texto — o fio.

          Mostra de quem era e um trecho. `line-clamp-2` porque serve para
          reconhecer, não para reler: a original está logo acima no histórico.
        */}
        {citada && (
          <div
            className={cn(
              "mb-1 rounded border-l-2 px-2 py-1 text-xs",
              isOutbound
                ? "border-primary-foreground/50 bg-primary-foreground/10"
                : "border-primary bg-background/60",
            )}
          >
            <div className="font-medium opacity-80">
              {citada.direction === "outbound" ? t("Você") : t("Cliente")}
            </div>
            {/*
              A CITADA PODE TER SIDO APAGADA — e aí o texto dela não volta aqui.

              A bolha principal já trata isto (`apagada`, acima): "mostrá-lo
              seria expor justamente o que o cliente pediu para tirar do ar". A
              citação é o mesmo texto, num segundo lugar da tela — sem esta
              linha, o "apagar para todos" do cliente sumia da bolha original e
              continuava legível dentro de cada resposta que a citou. O fio
              permanece (a citação some, não a resposta); o conteúdo, não.
            */}
            <div className={cn("line-clamp-2 opacity-70", citada.revoked_at && "italic")}>
              {citada.revoked_at
                ? t("Esta mensagem foi apagada")
                : citada.body?.trim() || t("(sem texto)")}
            </div>
          </div>
        )}
        {senderLabel && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
            {senderLabel === "IA" ? (
              <Robot size={10} weight="duotone" aria-hidden />
            ) : null}
            {senderLabel && t(senderLabel)}
          </div>
        )}

        {apagada ? (
          // Nem corpo nem mídia: o anexo apagado também sai. Em itálico e
          // esmaecido porque não é texto de ninguém — é o CRM narrando o que
          // aconteceu com aquele lugar da conversa.
          <p className="whitespace-pre-wrap break-words italic leading-snug opacity-60">
            {t("Esta mensagem foi apagada")}
          </p>
        ) : (
          <>
            {hasMedia && (
              <div className={cn(message.body && "mb-1")}>
                <MediaRenderer message={message} />
              </div>
            )}

            {isContact && !hasMedia && (
              <div className={cn(message.body && isContact && "mb-1")}>
                <ContactCard message={message} />
              </div>
            )}

            {message.body && !isContact && (
              <p
                className={cn(
                  "whitespace-pre-wrap break-words leading-snug",
                  // A faixa reservada para a hora só existe quando ela vai
                  // FLUTUAR — ver `horaFlutuante` acima. Com mídia ou citação o
                  // metadado volta para o fluxo, e reservar espaço ali deixaria
                  // um buraco no fim do texto.
                  horaFlutuante && "bolha-texto",
                )}
              >
                {message.body}
              </p>
            )}
          </>
        )}

        <div
          className={cn(
            "flex items-center justify-end gap-1 text-[10px]",
            horaFlutuante ? "bolha-meta-flutuante" : "mt-1",
            isOutbound ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {/* DE ONDE VEIO ESTA MENSAGEM — primeiro da fila de metadados porque é
              o único que responde "sob qual regra isto foi dito". Uma thread pode
              ter mensagens de antes de o número ser migrado de um canal para
              outro, e é a mensagem, não a conversa, que guarda por onde passou.
              Na variante `bolha` o selo é só ícone: o rótulo se repetiria em
              cada linha e empurraria a hora para fora. */}
          {temSeloDeCanal && (
            <TipoDeCanal
              provider={canalProvider}
              modo={canalModo}
              variante="bolha"
              className={isOutbound ? "text-primary-foreground/70" : undefined}
            />
          )}
          {editada && (
            // Ao lado da hora, não no corpo: o texto mostrado JÁ é o novo, e o
            // que falta é avisar que ele mudou. Sem isso, um combinado de preço
            // ou endereço é lido como se sempre tivesse dito aquilo — e a
            // divergência só aparece quando alguém cobra o que não foi.
            <span title={t("O autor editou esta mensagem")}>{t("editada")}</span>
          )}
          <span>{time}</span>
          {showCitationButton && (
            <CitationButton citations={citations} messageId={message.id} />
          )}
          {isOutbound && !isFailed && <AckIndicator status={message.status} t={t} />}
          {isFailed && (
            // Provider local: o painel do inbox não tem TooltipProvider ancestral e
            // este Tooltip só monta em mensagem failed — sem o provider, abrir uma
            // conversa com falha de envio derrubava o painel inteiro (error boundary).
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
                    <WarningOctagon size={10} weight="fill" aria-hidden /> {t("Falhou")}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {message.error_message ?? message.error_code ?? t("Erro desconhecido")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      {onResponder && !isOutbound && (
        <button
          type="button"
          onClick={() => onResponder(message)}
          aria-label={t("Responder a esta mensagem")}
          className={cn(
            "rounded p-1 text-muted-foreground transition-opacity hover:bg-muted",
            // VISÍVEL POR PADRÃO, e escondido só onde EXISTE hover.
            //
            // A primeira versão era `opacity-0` + `group-hover`, copiando o
            // WhatsApp Web. No celular isso deixa o botão invisível para
            // sempre: não há como passar o mouse, e `focus-visible` só chega
            // por teclado. Ou seja, a função sumia exatamente onde o dono
            // deste CRM mais atende.
            //
            // `@media (hover: hover)` pergunta pelo DISPOSITIVO, não pela
            // largura: um tablet largo com toque continua mostrando, e um
            // desktop estreito continua escondendo. Largura não é a pergunta.
            "opacity-100 [@media(hover:hover)]:opacity-0",
            "[@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <ArrowBendUpLeft size={14} />
        </button>
      )}
    </div>
  );
}
