/**
 * Este turno responde em ÁUDIO?
 *
 * `reply_as_audio` (0222) liga a voz; `reply_as_audio_mirror` (0226) a restringe
 * a quando o CLIENTE falou em áudio. Medido em produção (2026-10-06): o cliente
 * escrevia "oi bom dia" e recebia nota de voz — estranho para quem escreveu, e
 * mais lento (síntese + conversão a cada envio). Espelhar: texto recebe texto,
 * áudio recebe áudio.
 *
 * "O cliente falou em áudio" = alguma mensagem RECEBIDA do tipo áudio depois da
 * última mensagem que saiu nesta conversa — é o lote que este turno responde (o
 * debounce junta a rajada num turno só).
 */
import type pg from 'pg';

export function decidirRespostaEmAudio(input: {
  replyAsAudio: boolean;
  espelhar: boolean;
  clienteMandouAudio: boolean;
}): boolean {
  if (!input.replyAsAudio) return false;
  if (!input.espelhar) return true;
  return input.clienteMandouAudio;
}

export async function clienteMandouAudioDesdeAUltimaResposta(
  db: Pick<pg.Pool, 'query'>,
  tenantId: string,
  conversationId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ ha: boolean }>(
    `select exists (
       select 1
         from messages m
        where m.organization_id = $1
          and m.conversation_id = $2
          and m.direction = 'inbound'
          and m.type = 'audio'
          and m.created_at > coalesce(
                (select max(o.created_at)
                   from messages o
                  where o.organization_id = $1
                    and o.conversation_id = $2
                    and o.direction = 'outbound'),
                '-infinity'::timestamptz)
     ) as ha`,
    [tenantId, conversationId],
  );
  return rows[0]?.ha === true;
}
