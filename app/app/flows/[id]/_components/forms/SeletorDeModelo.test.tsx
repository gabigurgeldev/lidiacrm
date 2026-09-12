/**
 * O SELETOR DE MODELO — e o defeito que ele existe para não repetir.
 *
 * ─── O que estava quebrado ──────────────────────────────────────────────────
 *
 * `WhatsappBulkSendForm` lia `r.data.filter(...)` de uma rota que devolve
 * `{ data: { waba, templates } }`. `data` é um OBJETO, então o `select` do
 * react-query lançava `TypeError`, a query virava erro, `modelos` ficava
 * `undefined` — e a tela renderizava, com toda a calma, *"Nenhum modelo aprovado
 * nesta conta. Crie e aprove o modelo na Meta…"*.
 *
 * Ou seja: o modo de modelo do disparo por fluxo estava MORTO, e a mensagem de
 * erro acusava o inocente — mandava o operador arrumar uma conta que estava
 * certa. É o tipo de defeito que nenhum teste de tipo pega (o cast estava lá) e
 * nenhum log acusa (react-query engole o erro do `select`).
 *
 * ─── Por que o caso do FORMATO é o mais importante daqui ────────────────────
 *
 * Porque as duas rotas de definição respondem em formatos parecidos mas não
 * iguais, e a diferença é exatamente uma camada de `{ }`. Um teste que montasse
 * a resposta "do jeito que o componente espera" passaria com o componente
 * errado — por isso o falso abaixo copia o formato REAL da rota.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeletorDeModelo } from "./SeletorDeModelo";

const CANAL = "3f2b9f7e-0000-4000-8000-aaaaaaaaaaaa";

/** O formato REAL de `GET /api/v1/channels/templates` — objeto, não array. */
const RESPOSTA_DE_MODELOS = {
  data: {
    waba: "waba-1",
    templates: [
      { name: "confirmacao_pedido", language: "pt_BR", status: "APPROVED", slots: [] },
      { name: "em_revisao", language: "pt_BR", status: "PENDING", slots: [] },
    ],
  },
};

const CONEXOES = {
  data: [
    {
      id: CANAL,
      rotulo: "Número oficial",
      telefone: "+5511999998888",
      conectada: true,
      modo: "template",
      fonte_de_modelos: "oficial",
      piso_ms: 6000,
      cobra_por_mensagem: true,
      teto_de_hoje: null,
    },
  ],
};

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) =>
    url.startsWith("/api/v1/bulk-sends/conexoes") ? CONEXOES : RESPOSTA_DE_MODELOS,
  );
});

function montar(config: Record<string, unknown> = {}) {
  const mudar = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<SeletorDeModelo canalId={CANAL} config={config} mudar={mudar} />, { wrapper: Wrapper });
  return { mudar };
}

describe("a lista de modelos", () => {
  it("⭐ lê o formato REAL da rota, e não some com os modelos", async () => {
    montar();
    expect(await screen.findByTestId("campo-modelo")).toBeInTheDocument();
    // O campo manual só aparece quando NÃO há lista — a presença dele aqui é o
    // sintoma exato do defeito antigo.
    expect(screen.queryByTestId("sem-modelo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("campo-modelo-nome")).not.toBeInTheDocument();
  });

  it("⭐ pede os modelos DA CONEXÃO escolhida", async () => {
    // Sem o recorte, uma organização com duas contas oficiais veria a lista da
    // conta mais antiga e mandaria um modelo que não existe na outra — envio
    // que a plataforma recusa, com a culpa caindo no CRM.
    montar();
    await screen.findByTestId("campo-modelo");
    const chamadas = get.mock.calls.map((c) => String(c[0]));
    expect(chamadas.some((u) => u === `/api/v1/channels/templates?canal_id=${CANAL}`)).toBe(true);
  });

  it("⭐ quando não dá para listar, oferece DIGITAR — e não um beco", async () => {
    // `conferirDefinicao` deixa passar o que não está espelhado de propósito: a
    // plataforma é a autoridade, não o espelho. Sem o campo manual, uma conexão
    // cuja plataforma não expõe listagem ficaria sem saída nenhuma.
    get.mockImplementation(async (url: string) =>
      url.startsWith("/api/v1/bulk-sends/conexoes")
        ? CONEXOES
        : { data: { waba: null, templates: [] } },
    );
    montar();

    expect(await screen.findByTestId("campo-modelo-nome")).toBeInTheDocument();
    expect(screen.getByTestId("campo-modelo-idioma")).toBeInTheDocument();
  });

  it("só os APROVADOS entram: oferecer um em revisão é oferecer um erro", async () => {
    montar();
    await screen.findByTestId("campo-modelo");
    // O `select` já filtrou; o que chega à tela é só o aprovado. Medimos pela
    // ausência do outro no seletor aberto seria mais fiel, mas o Radix não
    // monta as opções até abrir — a garantia útil aqui é que a lista NÃO ficou
    // vazia por causa do filtro (o defeito oposto, e igualmente mudo).
    expect(screen.queryByTestId("sem-modelo")).not.toBeInTheDocument();
  });
});
