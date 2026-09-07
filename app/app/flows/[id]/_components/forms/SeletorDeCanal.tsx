"use client";

import { useQuery } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

/**
 * Por qual conexão o bloco manda.
 *
 * ## Por que esta lista vem de `/api/v1/bulk-sends/conexoes`
 *
 * Porque ela já responde a pergunta certa em vocabulário de PRODUTO — "aceita
 * texto livre" ou "exige modelo aprovado", "no mínimo N segundos entre
 * mensagens", "hoje até N mensagens" — sem nunca dizer QUEM é o canal. O
 * cabeçalho daquela rota explica as duas razões de ela existir, e as duas valem
 * aqui igual: a tela não pode conhecer canal (`scripts/lint-channels.ts` varre
 * `app/` e reprova), e a régua do ritmo não pode ter segunda cópia.
 *
 * O nome da rota fala em disparo porque foi lá que ela nasceu. O que ela devolve
 * — as conexões que servem para enviar — é o que qualquer bloco de envio precisa.
 *
 * ## Por que "a primeira disponível" é uma opção de primeira classe
 *
 * Quem tem UM número não deveria ter de escolher nada, e é a maioria. Deixar o
 * campo obrigatório faria toda instalação pequena carregar uma decisão que não
 * tem — e um fluxo publicado que quebra no dia em que o número é trocado, porque
 * o id guardado apontava para a conexão antiga.
 */
export interface ConexaoParaEnvio {
  id: string;
  rotulo: string;
  telefone: string | null;
  conectada: boolean;
  modo: "freeform" | "template";
  piso_ms: number;
  cobra_por_mensagem: boolean;
  teto_de_hoje: number | null;
}

export function useConexoesParaEnvio() {
  return useQuery({
    queryKey: ["bulk-send-conexoes"],
    queryFn: async () => apiClient.get<{ data: ConexaoParaEnvio[] }>("/api/v1/bulk-sends/conexoes"),
    select: (r) => r.data,
  });
}

export function SeletorDeCanal({
  valor,
  aoEscolher,
  permitirAutomatico = true,
  proposito = "envio",
}: {
  /** Id da conexão escolhida; `null` = ver `proposito`. */
  valor: string | null;
  aoEscolher: (id: string | null) => void;
  /** `false` no disparo em massa, onde a conexão precisa ser explícita. */
  permitirAutomatico?: boolean;
  /**
   * Para que serve a escolha — e o que `null` SIGNIFICA, que é o ponto.
   *
   * `envio`: por onde a mensagem sai. `null` = a primeira conexão disponível.
   * `escuta`: por quais números o gatilho começa. `null` = TODOS eles.
   *
   * São opostos: em `envio`, `null` escolhe um; em `escuta`, `null` não exclui
   * nenhum. Mostrar "A primeira conexão disponível" num gatilho faria o
   * operador achar que o fluxo escuta um número só — o contrário do que
   * acontece. E os detalhes de pacing e cobrança de cada cartão são sobre
   * mandar, não sobre receber: no gatilho eles são ruído.
   */
  proposito?: "envio" | "escuta";
}) {
  const t = useT();
  const { data: conexoes, isLoading } = useConexoesParaEnvio();

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("Carregando as conexões…")}</p>;
  }

  const lista = conexoes ?? [];
  if (lista.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="sem-conexao">
        {t("Nenhuma conexão de WhatsApp. Conecte um número em Conexões primeiro.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="seletor-de-canal">
      {permitirAutomatico && (
        <Cartao
          escolhido={valor === null}
          aoEscolher={() => aoEscolher(null)}
          titulo={
            proposito === "escuta"
              ? t("Todos os números conectados")
              : t("A primeira conexão disponível")
          }
          detalhe={
            proposito === "escuta"
              ? t("O fluxo começa por qualquer número que receber a mensagem.")
              : t("Serve quando há um número só, e não quebra se ele for trocado.")
          }
          testid="canal-automatico"
        />
      )}

      {lista.map((c) => (
        <Cartao
          key={c.id}
          escolhido={valor === c.id}
          aoEscolher={() => aoEscolher(c.id)}
          titulo={c.rotulo}
          aviso={c.conectada ? null : t("desconectado agora")}
          detalhe={
            proposito === "escuta"
              ? t("O fluxo só começa quando a mensagem chegar por este número.")
              : [
            c.modo === "template" ? t("Só envia modelo aprovado.") : t("Envia texto livre."),
            t("No mínimo {s}s entre mensagens.").replace(
              "{s}",
              String(Math.ceil(c.piso_ms / 1000)),
            ),
                  c.cobra_por_mensagem ? t("Cobra por mensagem.") : "",
                ]
                  .filter((x) => x !== "")
                  .join(" ")
          }
          testid={`canal-${c.id}`}
        />
      ))}
    </div>
  );
}

function Cartao({
  escolhido,
  aoEscolher,
  titulo,
  detalhe,
  aviso = null,
  testid,
}: {
  escolhido: boolean;
  aoEscolher: () => void;
  titulo: string;
  detalhe: string;
  aviso?: string | null;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-pressed={escolhido}
      data-testid={testid}
      className={`rounded-md border p-3 text-left text-sm transition-colors ${
        escolhido ? "border-primary bg-muted/50" : "hover:bg-muted/30"
      }`}
    >
      <span className="font-medium">{titulo}</span>
      {aviso !== null && <span className="ml-2 text-xs text-destructive">{aviso}</span>}
      <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
    </button>
  );
}
