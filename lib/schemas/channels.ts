import { z } from "zod";

/**
 * Body para conectar um novo canal WhatsApp. `display_name` é opcional —
 * um rótulo amigável ("Vendas", "Suporte").
 *
 * Quando ele vem VAZIO, o nome do perfil do WhatsApp (`me.pushName`) é adotado
 * na primeira vez que a sessão é vista em WORKING — regra e limites em
 * `lib/channels/nome-observado.ts`. O contrário não vale: um rótulo já
 * escolhido nunca é sobrescrito pelo perfil.
 *
 * Este comentário já afirmou que "o WAHA sobrescreve com o nome do perfil", e
 * isso era falso: nenhuma linha do repositório escrevia `display_name`, e a
 * tela de conectar enviava corpo vazio. O resultado era `display_name` NULL em
 * 100% das conexões, e o aviso de conexão caída dizendo "WhatsApp sem nome".
 */
export const createChannelSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

/** Status canônicos de sessão (WAHA + DB CHECK constraint). */
export const CHANNEL_STATUSES = [
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "STOPPED",
  "FAILED",
] as const;

export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export function isChannelStatus(v: string): v is ChannelStatus {
  return (CHANNEL_STATUSES as readonly string[]).includes(v);
}
