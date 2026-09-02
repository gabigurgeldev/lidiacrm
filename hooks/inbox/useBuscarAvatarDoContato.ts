"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { apiClient } from "@/lib/api/client";

/**
 * Pede a foto de perfil do contato da conversa ABERTA, uma única vez.
 *
 * ═══ O problema ═══
 *
 * O cron varre 25 contatos a cada 10 minutos, "quem nunca teve foto primeiro".
 * Numa base de mil contatos, o que a pessoa acabou de abrir pode estar a muitas
 * rodadas de distância — ela olha para a silhueta e conclui que o produto não
 * mostra foto. Aqui a conversa aberta pede a dela agora.
 *
 * ═══ As três travas, e nenhuma é opcional ═══
 *
 * 1. **`avatar_updated_at === null`** — só quem NUNCA foi tentado. O servidor
 *    repete a mesma guarda, mas ela precisa estar aqui também: sem ela, cada
 *    abertura de conversa dispara uma requisição, e o inbox reabre a mesma
 *    conversa dezenas de vezes por dia.
 * 2. **`tentados`** — uma vez por montagem, por contato. O `avatar_updated_at`
 *    só muda depois que a lista revalida, e nesse intervalo o efeito rodaria de
 *    novo a cada render que mexesse nas dependências.
 * 3. **Uma conversa por vez.** Este hook vive no painel da conversa aberta,
 *    nunca na lista. Uma lista de 50 linhas pedindo foto na rolagem seriam 50
 *    chamadas ao canal — o caminho mais curto para um 429 do WhatsApp, que
 *    derruba o ENVIO junto.
 *
 * ═══ Falhar aqui não é evento ═══
 *
 * Sem foto é o estado normal da maioria dos contatos, e a tela já sabe desenhar
 * isso. Um erro nesta chamada não vira aviso: viraria um alerta por conversa
 * aberta, sobre algo que a pessoa não pode resolver.
 */
export function useBuscarAvatarDoContato(
  contato:
    | {
        id?: string | null;
        avatar_storage_path?: string | null;
        avatar_updated_at?: string | null;
        is_anonymized?: boolean | null;
      }
    | null
    | undefined,
): void {
  const queryClient = useQueryClient();
  const tentados = useRef<Set<string>>(new Set());

  const id = contato?.id ?? null;
  const nuncaTentado = contato?.avatar_updated_at === null;
  const anonimizado = contato?.is_anonymized === true;

  useEffect(() => {
    if (!id || anonimizado || !nuncaTentado) return;
    if (tentados.current.has(id)) return;
    tentados.current.add(id);

    void apiClient
      .post<{ data: { buscou: boolean; resultado?: string } }>(
        `/api/v1/contacts/${id}/avatar`,
        {},
        // Uma tentativa: a busca passa por uma chamada ao canal, e repetir uma
        // falha de rede aqui custaria três idas ao WhatsApp por um avatar.
        { semRepetir: true, timeoutMs: 20_000 },
      )
      .then((r) => {
        // Só revalida quando a foto REALMENTE chegou. Invalidar sempre faria
        // toda conversa aberta recarregar a lista inteira para, na maioria das
        // vezes, redesenhar a mesma silhueta.
        if (r.data.resultado === "atualizado") {
          void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        }
      })
      .catch(() => {
        // Ver o cabeçalho: sem foto não é erro que se mostre.
      });
  }, [id, nuncaTentado, anonimizado, queryClient]);
}
