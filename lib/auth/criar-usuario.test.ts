/**
 * As regras que separam "adicionar alguém ao time" de "tomar a conta de alguém".
 *
 * A mais séria: quando o e-mail já pertence a uma conta existente — porque a
 * pessoa trabalha em OUTRA organização da mesma instalação — a senha digitada
 * NÃO pode ser aplicada. Se fosse, quem administra um tenant qualquer poderia
 * trocar a senha de qualquer usuário da instalação digitando o e-mail dele num
 * formulário de "criar usuário". A conta é vinculada; a credencial fica intacta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarUsuarioNaOrganizacao } from "./criar-usuario";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const ATOR = "22222222-2222-4222-8222-222222222222";

/** Dublê do client admin do Supabase, com só o que esta função usa. */
function fazerAdmin(opcoes: {
  createUser?: { data?: { user: { id: string } } | null; error?: { message: string } | null };
  usuariosExistentes?: Array<{ id: string; email: string }>;
  vinculo?: { user_id: string; revoked_at: string | null } | null;
}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const updateUserById = vi.fn();

  const admin = {
    auth: {
      admin: {
        createUser: vi.fn(async () => ({
          data: opcoes.createUser?.data ?? null,
          error: opcoes.createUser?.error ?? { message: "duplicado" },
        })),
        listUsers: vi.fn(async () => ({
          data: { users: opcoes.usuariosExistentes ?? [] },
          error: null,
        })),
        updateUserById,
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: opcoes.vinculo ?? null })),
          })),
        })),
      })),
      insert: vi.fn(async (linha: unknown) => {
        inserts.push(linha);
        return { error: null };
      }),
      update: vi.fn((linha: unknown) => {
        updates.push(linha);
        return { eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
      }),
    })),
  };

  return { admin, inserts, updates, updateUserById };
}

const BASE = {
  organizationId: ORG,
  atorUserId: ATOR,
  email: "Pessoa@Empresa.com.BR",
  senha: "senha-bem-comprida",
  papel: "agent" as const,
};

beforeEach(() => vi.clearAllMocks());

describe("criarUsuarioNaOrganizacao", () => {
  it("cria a conta e vincula, com accepted_at preenchido", async () => {
    const { admin, inserts } = fazerAdmin({
      createUser: { data: { user: { id: "user-novo" } }, error: null },
      vinculo: null,
    });

    const r = await criarUsuarioNaOrganizacao({
      ...BASE,
      admin: admin as never,
    });

    expect(r).toMatchObject({ ok: true, userId: "user-novo", criouConta: true });

    // `accepted_at` na hora: não há convite a aceitar. Sem ele, a tela de equipe
    // mostraria "Pendente" para sempre a quem já pode entrar.
    const vinculo = inserts[0] as Record<string, unknown>;
    expect(vinculo.accepted_at).toBeTruthy();
    expect(vinculo.role).toBe("agent");
    expect(vinculo.organization_id).toBe(ORG);
  });

  it("normaliza o e-mail para minúsculas antes de criar", async () => {
    const { admin } = fazerAdmin({
      createUser: { data: { user: { id: "u1" } }, error: null },
      vinculo: null,
    });

    await criarUsuarioNaOrganizacao({ ...BASE, admin: admin as never });

    expect(admin.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "pessoa@empresa.com.br" }),
    );
  });

  it("conta que JÁ EXISTE é vinculada sem tocar na senha", async () => {
    const { admin, updateUserById, inserts } = fazerAdmin({
      // createUser recusa: e-mail duplicado.
      createUser: { data: null, error: { message: "email already registered" } },
      usuariosExistentes: [{ id: "user-antigo", email: "pessoa@empresa.com.br" }],
      vinculo: null,
    });

    const r = await criarUsuarioNaOrganizacao({ ...BASE, admin: admin as never });

    expect(r).toMatchObject({ ok: true, userId: "user-antigo", criouConta: false });

    // O ponto inteiro deste arquivo: a senha da conta existente fica INTACTA.
    // Trocá-la seria permitir tomar a conta de alguém a partir do formulário de
    // outra organização.
    expect(updateUserById).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
  });

  it("quem já é membro ativo é recusado — e nada é escrito", async () => {
    const { admin, inserts, updates } = fazerAdmin({
      createUser: { data: null, error: { message: "email already registered" } },
      usuariosExistentes: [{ id: "user-antigo", email: "pessoa@empresa.com.br" }],
      vinculo: { user_id: "user-antigo", revoked_at: null },
    });

    const r = await criarUsuarioNaOrganizacao({ ...BASE, admin: admin as never });

    expect(r).toEqual({ ok: false, motivo: "ja_e_membro" });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("membro REVOGADO é reativado com o papel novo, em vez de recusado", async () => {
    // Recusar obrigaria quem opera a descobrir sozinho que a pessoa já esteve
    // aqui — informação que a tela não mostra.
    const { admin, updates } = fazerAdmin({
      createUser: { data: null, error: { message: "email already registered" } },
      usuariosExistentes: [{ id: "user-antigo", email: "pessoa@empresa.com.br" }],
      vinculo: { user_id: "user-antigo", revoked_at: "2026-01-01T00:00:00Z" },
    });

    const r = await criarUsuarioNaOrganizacao({
      ...BASE,
      papel: "manager",
      admin: admin as never,
    });

    expect(r).toMatchObject({ ok: true, criouConta: false });
    expect(updates[0]).toMatchObject({ role: "manager", revoked_at: null });
  });

  it("e-mail desconhecido e criação recusada devolve falha, sem vincular ninguém", async () => {
    const { admin, inserts } = fazerAdmin({
      createUser: { data: null, error: { message: "weak password" } },
      usuariosExistentes: [],
      vinculo: null,
    });

    const r = await criarUsuarioNaOrganizacao({ ...BASE, admin: admin as never });

    expect(r).toMatchObject({ ok: false, motivo: "auth" });
    expect(inserts).toHaveLength(0);
  });

  it("o audit NÃO carrega e-mail nem senha", async () => {
    const { audit } = await import("@/lib/audit");
    const { admin } = fazerAdmin({
      createUser: { data: { user: { id: "u1" } }, error: null },
      vinculo: null,
    });

    await criarUsuarioNaOrganizacao({ ...BASE, admin: admin as never });

    const chamada = vi.mocked(audit).mock.calls[0]?.[0];
    const texto = JSON.stringify(chamada);
    expect(texto).not.toContain("senha-bem-comprida");
    expect(texto.toLowerCase()).not.toContain("pessoa@empresa.com.br");
  });
});
