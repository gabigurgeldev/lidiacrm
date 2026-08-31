/**
 * EPIC-09 Team & Permissions — Zod schemas for invite, accept, role change, and api token.
 *
 * Roles are stored as `text` with a check constraint (not enum) on
 * `user_organizations.role` per project doctrine — keep this list in sync
 * with the DB constraint when adding/removing roles.
 */
import { z } from "zod";

export const ROLES = ["viewer", "agent", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const inviteMemberSchema = z.object({
  invitations: z
    .array(
      z.object({
        email: z.string().email(),
        role: z.enum(ROLES),
      }),
    )
    .min(1)
    .max(20),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Criar a pessoa direto, com senha, em vez de mandar convite.
 *
 * `min(8)` é a MESMA régua de `lib/auth/schemas.ts` — a senha definida aqui é a
 * senha com que a pessoa vai entrar pelo login normal, então exigir aqui algo
 * diferente do que o login exige seria duas réguas para a mesma coisa.
 */
export const criarMembroSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
  role: z.enum(ROLES),
  nome: z.string().trim().min(1).max(120).optional(),
});
export type CriarMembroInput = z.infer<typeof criarMembroSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(ROLES),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const createApiTokenSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(z.string()).min(1),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
