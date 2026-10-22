/**
 * QUEM É ATENDIDO VEM DA CONVERSA, NÃO DO MODELO (`lib/mcp/turno.ts`).
 *
 * Num turno, `crm_book_appointment` tem `contact_id` e `conversation_id`
 * preenchidos pelo turno — e o modelo nem vê os campos. Três coisas a provar, e
 * cada uma tem um jeito próprio de quebrar calada:
 *
 *   1. o schema que o MODELO recebe não tem os campos (senão ele os inventa);
 *   2. o handler recebe os valores do TURNO, mesmo que o modelo mande outro;
 *   3. o GATE de escopo de funil vê o valor injetado — ele decide por
 *      `contact_id`, e injetar depois dele seria decidir sobre um contato e
 *      gravar outro.
 *
 * E o controle: fora de turno (servidor MCP externo) nada muda — o campo segue
 * no schema e obrigatório.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn(async () => undefined) }));

const vereditos: { ferramenta: string; argumentos: Record<string, unknown> }[] = [];
vi.mock("@/lib/leads/escopo-de-funil", async (original) => {
  const real = await original<typeof import("@/lib/leads/escopo-de-funil")>();
  return {
    ...real,
    podeChamarFerramenta: vi.fn(async (e: { ferramenta: string; argumentos: Record<string, unknown> }) => {
      vereditos.push({ ferramenta: e.ferramenta, argumentos: { ...e.argumentos } });
      return { permitido: true };
    }),
  };
});

const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");
const { crmBookAppointment, crmFindFreeSlots } = await import("@/lib/mcp/tools/agendamento");
const { aplicarTurno, shapeVisivel, CAMPOS_DO_TURNO } = await import("@/lib/mcp/turno");
import type { McpAuthResult } from "@/lib/mcp/auth";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO_DA_CONVERSA = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const CONTATO_INVENTADO = "99999999-9999-4999-8999-999999999999";

function montar(turno: McpContext["turno"]) {
  const ctx = {
    organizationId: ORG,
    role: "ai_operator",
    actor: { type: "ai_agent", id: "agente-1", role: "ai_operator" },
    apiTokenId: "tok-1",
    requestId: "run-1",
    supabase: {} as never,
    ...(turno ? { turno } : {}),
  } as unknown as McpContext;
  const auth = {
    organizationId: ORG,
    role: "ai_operator",
    actor: ctx.actor,
    apiTokenId: "tok-1",
    scopes: ["mcp:read", "mcp:write", "actor:ai_agent"],
  } as unknown as McpAuthResult;
  return pickToolsFromMcp({
    supabase: ctx.supabase,
    ctx,
    auth,
    toolIds: ["crm_book_appointment", "crm_find_free_slots"],
    handoffToolEnabled: false,
    handoffSignal: { triggered: false },
    pipelineIds: ["funil-1"],
  });
}

function camposDoSchema(t: unknown): string[] {
  const schema = (t as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;
  return Object.keys(schema.shape);
}

async function executar(t: unknown, args: Record<string, unknown>) {
  const exec = (t as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute;
  return exec(args, { toolCallId: "tc-1", messages: [] });
}

describe("com contexto de turno", () => {
  beforeEach(() => {
    vereditos.length = 0;
    vi.restoreAllMocks();
  });

  it("o modelo NÃO vê contact_id nem conversation_id", () => {
    const tools = montar({ conversationId: CONVERSA, contactId: CONTATO_DA_CONVERSA });
    const campos = camposDoSchema(tools.crm_book_appointment);
    expect(campos).not.toContain("contact_id");
    expect(campos).not.toContain("conversation_id");
    // CONTROLE: o resto do schema continua lá — não virou objeto vazio.
    expect(campos).toEqual(expect.arrayContaining(["event_type_slug", "starts_at", "professional_ids"]));
  });

  it("o handler recebe os valores do TURNO, mesmo que o modelo mande outro contato", async () => {
    const espiao = vi.spyOn(crmBookAppointment, "handler").mockResolvedValue({ marcado: true });
    const tools = montar({ conversationId: CONVERSA, contactId: CONTATO_DA_CONVERSA });
    await executar(tools.crm_book_appointment, {
      event_type_slug: "consulta",
      starts_at: "2026-09-01T14:00:00Z",
      contact_id: CONTATO_INVENTADO,
    });
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(espiao.mock.calls[0]![0]).toMatchObject({
      contact_id: CONTATO_DA_CONVERSA,
      conversation_id: CONVERSA,
    });
  });

  it("o GATE de escopo de funil vê o contato injetado — não o do modelo", async () => {
    vi.spyOn(crmBookAppointment, "handler").mockResolvedValue({ marcado: true });
    const tools = montar({ conversationId: CONVERSA, contactId: CONTATO_DA_CONVERSA });
    await executar(tools.crm_book_appointment, {
      event_type_slug: "consulta",
      starts_at: "2026-09-01T14:00:00Z",
      contact_id: CONTATO_INVENTADO,
    });
    const doBook = vereditos.find((v) => v.ferramenta === "crm_book_appointment");
    expect(doBook?.argumentos.contact_id).toBe(CONTATO_DA_CONVERSA);
  });

  it("ferramenta SEM campos de turno não muda nada", async () => {
    const tools = montar({ conversationId: CONVERSA, contactId: CONTATO_DA_CONVERSA });
    expect(camposDoSchema(tools.crm_find_free_slots)).toEqual(Object.keys(crmFindFreeSlots.inputSchema));
  });
});

describe("SEM contexto de turno (servidor MCP externo, Operador)", () => {
  beforeEach(() => {
    vereditos.length = 0;
    vi.restoreAllMocks();
  });

  it("contact_id segue no schema — quem chama TEM de dizer de quem é a consulta", () => {
    const tools = montar(undefined);
    expect(camposDoSchema(tools.crm_book_appointment)).toEqual(
      expect.arrayContaining(["contact_id", "conversation_id"]),
    );
    // E obrigatório: a definição exige, não só mostra.
    expect(crmBookAppointment.inputSchema.contact_id.isOptional()).toBe(false);
  });

  it("o handler recebe exatamente o que veio", async () => {
    const espiao = vi.spyOn(crmBookAppointment, "handler").mockResolvedValue({ marcado: true });
    const tools = montar(undefined);
    await executar(tools.crm_book_appointment, {
      event_type_slug: "consulta",
      starts_at: "2026-09-01T14:00:00Z",
      contact_id: CONTATO_INVENTADO,
    });
    expect(espiao.mock.calls[0]![0]).toMatchObject({ contact_id: CONTATO_INVENTADO });
    expect(espiao.mock.calls[0]![0]).not.toHaveProperty("conversation_id");
  });
});

describe("as funções puras", () => {
  it("a lista de campos do turno é a da marcação, e só ela", () => {
    expect(CAMPOS_DO_TURNO).toEqual({ crm_book_appointment: ["contact_id", "conversation_id"] });
  });

  it("sem turno, o shape é a MESMA referência", () => {
    const shape = crmBookAppointment.inputSchema;
    expect(shapeVisivel("crm_book_appointment", shape, undefined)).toBe(shape);
  });

  it("aplicarTurno não toca ferramenta alheia", () => {
    const args = { contact_id: CONTATO_INVENTADO };
    expect(
      aplicarTurno("crm_list_appointments", args, { conversationId: CONVERSA, contactId: CONTATO_DA_CONVERSA }),
    ).toBe(args);
  });
});
