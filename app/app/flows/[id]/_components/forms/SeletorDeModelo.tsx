"use client";

import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import { CampoComVariavel } from "./CampoComVariavel";
import { useConexoesParaEnvio } from "./SeletorDeCanal";
import { Campo, Dica } from "./shared";

/**
 * ESCOLHER A DEFINIÇÃO APROVADA — nos três blocos que mandam mensagem.
 *
 * ## Por que um componente, e não o mesmo bloco copiado três vezes
 *
 * Porque ele é grande e tem duas regras que não se veem: a lista vem de rotas
 * DIFERENTES conforme a conexão, e trocar de modelo tem de zerar os valores.
 * Três cópias divergiriam na primeira correção, e a divergência apareceria como
 * "no disparo funciona e no envio não".
 *
 * ## A tela NÃO sabe qual é o canal
 *
 * Ela recebe `fonte_de_modelos` — "oficial", "parceiro" ou nada — junto da lista
 * de conexões, e monta a URL com esse rótulo. `scripts/lint-channels.ts` varre
 * `app/` e reprova qualquer arquivo que nomeie um provider; a decisão vive em
 * `lib/channels/templates-fonte.ts`, que a toma pela CONEXÃO (provider +
 * modalidade), porque um mesmo provider hospeda número com definições aprovadas
 * e número sem nenhuma.
 *
 * ## Por que existe o caminho de DIGITAR o nome
 *
 * Porque listar nem sempre é possível, e o pré-voo do envio já conta com isso:
 * `lib/channels/conferir-definicao.ts` deixa passar o que não está espelhado, de
 * propósito — "recusar o que não se sabe é pior que deixar o provedor responder,
 * ele é a autoridade, não este espelho". Sem o campo manual, uma conexão cuja
 * plataforma não expõe listagem ficaria com um seletor vazio e nenhuma saída,
 * que é exatamente o beco que o aviso de janela fechada existe para evitar.
 */

/** O que a listagem devolve, do que esta tela precisa. */
interface ModeloAprovado {
  name: string;
  language: string;
  status: string;
  slots?: Array<{ key: string; expects: string; onde: string }>;
}

/** As duas rotas respondem em formatos diferentes; as duas trazem `templates`. */
interface RespostaDeModelos {
  data: { templates?: ModeloAprovado[] };
}

const ROTA_DA_FONTE: Record<string, string> = {
  oficial: "/api/v1/channels/templates",
  parceiro: "/api/v1/channels/partner/templates",
};

export function SeletorDeModelo({
  canalId,
  config,
  mudar,
}: {
  /** A conexão escolhida no bloco. `null` = nenhuma, e aí não há lista possível. */
  canalId: string | null;
  config: Record<string, unknown>;
  mudar: (patch: Record<string, unknown>) => void;
}) {
  const t = useT();
  const { data: conexoes } = useConexoesParaEnvio();
  const conexao = (conexoes ?? []).find((c) => c.id === canalId) ?? null;
  const fonte = conexao?.fonte_de_modelos ?? null;
  const rota = fonte === null ? null : (ROTA_DA_FONTE[fonte] ?? null);

  const { data: modelos, isLoading } = useQuery({
    // A conexão entra na chave: duas conexões têm definições diferentes, e servir
    // a lista em cache da anterior ofereceria um modelo que não existe nesta conta.
    queryKey: ["modelos-da-conexao", fonte, canalId],
    enabled: rota !== null && canalId !== null,
    queryFn: async () => apiClient.get<RespostaDeModelos>(`${rota}?canal_id=${canalId}`),
    select: (r) => (r.data.templates ?? []).filter((m) => m.status?.toUpperCase() === "APPROVED"),
    staleTime: 30_000,
  });

  const lista = modelos ?? [];
  const nome = String(config.modelo_nome ?? "");
  const idioma = String(config.modelo_idioma ?? "");
  const valores = (config.modelo_valores ?? {}) as Record<string, string>;
  const escolhido = lista.find((m) => m.name === nome && m.language === idioma) ?? null;
  const listaVazia = rota === null || (!isLoading && lista.length === 0);

  const trocarModelo = (novoNome: string, novoIdioma: string) => {
    // Trocar de modelo ZERA os valores: as variáveis de um não são as do outro,
    // e aproveitá-las mandaria o texto errado nas lacunas certas — o pior tipo
    // de mensagem enviada, porque ela sai e parece certa.
    mudar({ modelo_nome: novoNome, modelo_idioma: novoIdioma, modelo_valores: {} });
  };

  return (
    <>
      <Campo rotulo={t("Modelo aprovado")}>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("Carregando os modelos…")}</p>
        ) : listaVazia ? (
          // NÃO é um beco: o campo de digitar aparece logo abaixo. A frase diz o
          // que aconteceu e o que fazer, em vez de só constatar a lista vazia.
          <p className="text-xs text-muted-foreground" data-testid="sem-modelo">
            {canalId === null
              ? t("Escolha primeiro por qual conexão enviar — os modelos são aprovados por conta.")
              : t(
                  "Não consegui listar os modelos desta conexão. Escreva abaixo o nome e o idioma exatos do modelo já aprovado.",
                )}
          </p>
        ) : (
          <Select
            value={nome === "" ? "" : `${nome}|${idioma}`}
            onValueChange={(v) => {
              const [n, i] = v.split("|");
              trocarModelo(n ?? "", i ?? "");
            }}
          >
            <SelectTrigger data-testid="campo-modelo">
              <SelectValue placeholder={t("Escolha o modelo")} />
            </SelectTrigger>
            <SelectContent>
              {lista.map((m) => (
                <SelectItem key={`${m.name}|${m.language}`} value={`${m.name}|${m.language}`}>
                  {m.name} ({m.language})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Dica
          texto={t(
            "Fora da janela de 24 horas, uma conexão oficial só entrega modelo aprovado — é regra da plataforma, não do produto.",
          )}
        />
      </Campo>

      {listaVazia && (
        <>
          <Campo rotulo={t("Nome do modelo")}>
            <Input
              value={nome}
              maxLength={200}
              placeholder="confirmacao_pedido"
              onChange={(e) => trocarModelo(e.target.value, idioma)}
              data-testid="campo-modelo-nome"
            />
          </Campo>
          <Campo rotulo={t("Idioma do modelo")}>
            <Input
              value={idioma}
              maxLength={20}
              placeholder="pt_BR"
              onChange={(e) => trocarModelo(nome, e.target.value)}
              data-testid="campo-modelo-idioma"
            />
            <Dica
              texto={t(
                "Exatamente como está aprovado: pt_BR e pt são modelos diferentes na plataforma.",
              )}
            />
          </Campo>
        </>
      )}

      {/*
        Um campo por lacuna do modelo, COM o seletor de variáveis: é assim que a
        definição aprovada leva o nome de quem recebe, em vez de um texto fixo.
        Quando a lista não veio, não há contrato para derivar as lacunas — e
        adivinhá-las seria pior que deixar a plataforma responder.
      */}
      {escolhido?.slots?.map((slot) => (
        <Campo key={slot.key} rotulo={t("Valor de {k}").replace("{k}", slot.key)}>
          <CampoComVariavel
            valor={valores[slot.key] ?? ""}
            aoMudar={(v) => mudar({ modelo_valores: { ...valores, [slot.key]: v } })}
            testid={`campo-valor-${slot.key}`}
          />
        </Campo>
      ))}
    </>
  );
}
