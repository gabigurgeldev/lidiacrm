/**
 * A lista de agentes agrupada por número.
 *
 * A pergunta do dono é "quem atende o meu WhatsApp X?". A lista antiga era uma
 * grade de cartões sem número: dois agentes no mesmo número apareciam soltos,
 * e um número conectado sem agente nenhum simplesmente não aparecia.
 *
 * Sabotagens medidas:
 *  - `ordemDoMotor` sem a prioridade ⇒ "ordem do motor" vermelho;
 *  - `agruparPorNumero` sem os números vazios ⇒ "número sem agente" e a tela
 *    vermelhos.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { agruparPorNumero } from "@/lib/ai/agents/lista-por-numero";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/app/ai/agents/_components/AgentRowMenu", () => ({ AgentRowMenu: () => null }));
const lista = vi.hoisted(() => ({ dados: [] as unknown[] }));
vi.mock("@/hooks/ai/useAgents", () => ({ useAgentsList: () => ({ data: lista.dados, isLoading: false }) }));

import { AgentsList } from "@/app/app/ai/agents/_components/AgentsList";

afterEach(cleanup);

const LOJA = { id: "n1", display_name: "Loja", phone_number: "+55 11 90000-0001", status: "WORKING" };
const SUPORTE = { id: "n2", display_name: "Suporte", phone_number: null, status: "WORKING" };

function agente(id: string, o: { prioridade?: number; numero?: string | null; criado?: string; arquivado?: boolean; publicado?: boolean } = {}) {
  return {
    id,
    name: `Agente ${id}`,
    organization_id: "org",
    kind: "mcp_agent",
    priority: o.prioridade ?? 0,
    created_at: o.criado ?? "2026-01-01T00:00:00Z",
    archived_at: o.arquivado ? "2026-02-01T00:00:00Z" : null,
    is_active: true,
    is_default: false,
    published_version_id: o.publicado === false ? null : `v-${id}`,
    model: "claude-sonnet-4-6",
    versao_publicada: o.publicado === false ? null : { provider: "anthropic", model: "claude-sonnet-4-6", channel_session_id: o.numero ?? null },
  };
}

const arquivado = (a: { archived_at: string | null }) => a.archived_at !== null;

describe("agruparPorNumero", () => {
  it("ordem do motor dentro do número: prioridade maior primeiro, depois o mais antigo", () => {
    const g = agruparPorNumero(
      [
        agente("b", { numero: "n1", prioridade: 1, criado: "2026-01-02" }),
        agente("a", { numero: "n1", prioridade: 5 }),
        agente("c", { numero: "n1", prioridade: 1, criado: "2026-01-01" }),
      ],
      [LOJA],
      { arquivado, mostrarArquivados: false },
    );
    expect(g[0]!.agentes.map((a) => a.id)).toEqual(["a", "c", "b"]);
  });

  it("número conectado sem agente aparece, vazio", () => {
    const g = agruparPorNumero([agente("a", { numero: "n1" })], [LOJA, SUPORTE], { arquivado, mostrarArquivados: false });
    expect(g.map((x) => (x.chave.tipo === "numero" ? x.chave.numero.id : x.chave.tipo))).toEqual(["n1", "n2"]);
    expect(g[1]!.agentes).toEqual([]);
  });

  it("rascunho (sem versão publicada) vai para 'sem número'", () => {
    const g = agruparPorNumero([agente("r", { publicado: false })], [LOJA], { arquivado, mostrarArquivados: false });
    expect(g.at(-1)!.chave.tipo).toBe("sem_numero");
    expect(g.at(-1)!.agentes.map((a) => a.id)).toEqual(["r"]);
  });

  it("arquivados só com o filtro, no fim", () => {
    const ag = [agente("x", { numero: "n1", arquivado: true })];
    expect(agruparPorNumero(ag, [LOJA], { arquivado, mostrarArquivados: false }).some((g) => g.chave.tipo === "arquivados")).toBe(false);
    expect(agruparPorNumero(ag, [LOJA], { arquivado, mostrarArquivados: true }).at(-1)!.chave.tipo).toBe("arquivados");
  });
});

describe("tela da lista", () => {
  it("um grupo por número, com quem atende; número vazio diz que ninguém atende", () => {
    lista.dados = [agente("a", { numero: "n1", prioridade: 2 }), agente("b", { numero: "n1" }), agente("r", { publicado: false })];
    render(<AgentsList initialData={[]} numeros={[LOJA, SUPORTE]} canWrite />);

    const loja = screen.getByTestId("agentes-grupo-n1");
    expect(within(loja).getAllByTestId("agente-linha").map((l) => l.textContent)).toEqual([
      expect.stringContaining("Agente a"),
      expect.stringContaining("Agente b"),
    ]);
    expect(screen.getByText(/Quem está em cima atende primeiro/)).toBeInTheDocument();
    expect(within(screen.getByTestId("agentes-grupo-n2")).getByTestId("numero-sem-agente")).toBeInTheDocument();
    expect(within(screen.getByTestId("agentes-grupo-sem_numero")).getByText("Agente r")).toBeInTheDocument();
  });

  it("sem agente nenhum: estado vazio explica, sem grade vazia", () => {
    lista.dados = [];
    render(<AgentsList initialData={[]} numeros={[LOJA]} canWrite />);
    expect(screen.getByTestId("agentes-vazio")).toHaveTextContent("Nenhum agente ainda");
  });
});
