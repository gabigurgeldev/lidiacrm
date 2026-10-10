/**
 * Na lista de organizações do admin da plataforma, ERRO não é lista vazia.
 *
 * A consulta passou a falhar (embed ambíguo depois da migration 0229 — ver
 * `tests/unit/embed-sem-ambiguidade.test.ts`), e a tela mostrava "0 tenants /
 * Nenhum tenant encontrado": quem administra concluiu que não havia organização
 * nenhuma. Falha tem de aparecer como falha, com o motivo e um jeito de tentar.
 *
 * Sabotagem medida: tirar o ramo `isError` de `_client.tsx` deixa o primeiro
 * caso vermelho.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

const estado = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }));
vi.mock("@/hooks/useAdminTenants", () => ({ useAdminTenants: () => estado.valor }));

import { TenantsClient } from "@/app/admin/(protected)/tenants/_client";

afterEach(cleanup);

const base = { hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() };

describe("lista de organizações do admin", () => {
  it("consulta que falhou mostra o erro, não 'nenhum tenant'", () => {
    estado.valor = { ...base, isLoading: false, isError: true, error: new Error("Query failed"), data: undefined };
    render(<TenantsClient />);
    expect(screen.getByTestId("tenants-erro")).toHaveTextContent("Query failed");
    expect(screen.queryByText("Nenhum tenant encontrado")).not.toBeInTheDocument();
    expect(screen.queryByText("0 tenants")).not.toBeInTheDocument();
  });

  it("lista vazia de verdade continua dizendo que está vazia", () => {
    estado.valor = { ...base, isLoading: false, isError: false, error: null, data: { pages: [{ data: [] }] } };
    render(<TenantsClient />);
    expect(screen.queryByTestId("tenants-erro")).not.toBeInTheDocument();
    expect(screen.getByText("0 tenants")).toBeInTheDocument();
  });
});
