"use client";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useUserOpcional } from "@/hooks/auth/AuthProvider";
import { assinar, nomeParaAssinar } from "@/lib/assinatura-do-atendente";
import type { Message } from "@/lib/types/messaging";

interface SendArgs {
  conversation_id: string;
  body?: string;
  media_url?: string;
  media_mime?: string;
  media_storage_path?: string;
  media_size_bytes?: number;
  type?: string;
  /**
   * Definição aprovada — o caminho de volta quando a janela de 24h fechou. A
   * rota já aceitava estes campos; só o front nunca os mandava, então não havia
   * como disparar um modelo pelo inbox.
   */
  template_name?: string;
  template_language?: string;
  template_values?: Record<string, string>;
  /** A mensagem citada — id da NOSSA linha; o handler traduz para o do canal. */
  reply_to_message_id?: string;
  metadata?: Record<string, unknown>;
  /** Só em `type: "poll" | "list"` — o handler decide o que o canal desenha. */
  opcoes?: { pergunta: string; opcoes: { id: string; label: string }[]; botao?: string };
}

interface MessagesPage {
  data: Message[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function useSendMessage() {
  const qc = useQueryClient();
  // Só para a bolha otimista: quem assina de verdade é a rota, com o nome do
  // JWT. Sem isto a bolha apareceria sem o nome e "ganharia" a assinatura no
  // refetch — o texto pulando de lugar na frente de quem acabou de enviar.
  const nomeDaAssinatura = nomeParaAssinar(useUserOpcional()?.assinatura);

  return useMutation({
    // UMA tentativa. O cliente repete POST que estoura o teto de tempo, e o
    // envio é o caso em que repetir é o pior a fazer: o servidor costuma ter
    // aceitado a primeira — só demorou a responder —, e cada repetição vira
    // outra mensagem no WhatsApp do cliente. Mensagem dobrada não se desfaz;
    // um erro na tela, sim (o `onError` relê o hilo e a mensagem aparece se
    // tiver saído). Visto em produção com a CPU saturada.
    mutationFn: async (input: SendArgs) =>
      apiClient.post<{ data: Message }>("/api/v1/messages", input, { semRepetir: true }),
    onMutate: async (args) => {
      // Opções: o tipo e o corpo saem do servidor (o canal pode rebaixar para
      // texto), então o otimista mentiria — espera a resposta, como o contato.
      if (
        args.media_storage_path ||
        args.media_url ||
        args.type === "contact" ||
        args.type === "poll" ||
        args.type === "list"
      )
        return {};

      const queryKey = ["messages", args.conversation_id];
      await qc.cancelQueries({ queryKey });

      const tempId = `temp-${Date.now()}`;
      const tempMsg: Message = {
        id: tempId,
        organization_id: "",
        conversation_id: args.conversation_id,
        channel_session_id: "",
        contact_id: "",
        external_id: null,
        type: args.type ?? "text",
        direction: "outbound",
        status: "queued",
        ack: null,
        error_code: null,
        error_message: null,
        // Mesma regra do handler: texto com conteúdo (mídia nem chega aqui).
        body:
          args.body && nomeDaAssinatura && (args.type ?? "text") === "text" && args.body.trim()
            ? assinar(args.body, nomeDaAssinatura)
            : (args.body ?? null),
        media_url: args.media_url ?? null,
        media_mime: args.media_mime ?? null,
        media_size_bytes: null,
        media_storage_path: null,
        reply_to_message_id: args.reply_to_message_id ?? null,
        sent_via: "user",
        sent_by_user_id: null,
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        metadata: { _optimistic: true },
        // Mensagem que acaba de sair não foi editada nem apagada — mas os
        // campos precisam existir: sem eles o otimista não é do mesmo tipo do
        // que volta do servidor, e a bolha passaria a renderizar dois formatos.
        edited_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      };

      qc.setQueryData<InfiniteData<MessagesPage>>(queryKey, (old) => {
        if (!old) return old;
        const pages = [...old.pages];
        if (pages.length > 0) {
          const lastIdx = pages.length - 1;
          const lastPage = pages[lastIdx]!;
          pages[lastIdx] = {
            ...lastPage,
            data: [...lastPage.data, tempMsg],
          };
        }
        return { ...old, pages };
      });

      return { tempId };
    },
    onError: (err, args) => {
      qc.invalidateQueries({ queryKey: ["messages", args.conversation_id] });
      showApiError(err);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: ["messages", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
