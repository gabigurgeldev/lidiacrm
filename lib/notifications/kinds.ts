export const NOTIFY_KINDS = {
  message_inbound: { sound: "message", tagPrefix: "msg" },
  alerts_toggle: { sound: "success", tagPrefix: "alerts" },
  lead_assigned: { sound: "attention", tagPrefix: "lead-assigned" },
  /** Conversa nova que acabou de cair para a pessoa (rodízio ou atribuição). */
  lead_novo: { sound: "attention", tagPrefix: "lead-novo" },
  lead_won: { sound: "success", tagPrefix: "lead-won" },
  lead_lost: { sound: "failure", tagPrefix: "lead-lost" },
  mention: { sound: "attention", tagPrefix: "mention" },
} as const;

export type NotifyKind = keyof typeof NOTIFY_KINDS;
