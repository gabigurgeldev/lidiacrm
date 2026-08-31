/**
 * O SCHEMA DE GERAÇÃO PRECISA CABER NUM PROVEDOR DE SAÍDA ESTRUTURADA.
 *
 * O passo "Montar o fluxo" falhava com "A IA não conseguiu terminar o fluxo",
 * sem log no servidor e sem linha no audit. A causa não estava no tamanho do
 * schema, e sim na FORMA dele depois de convertido para JSON Schema:
 *
 *   - `$ref` recursivo, vindo do `z.lazy` de `grupoSchema` — o Gemini não
 *     suporta `$ref`/`$defs`, e a chamada falha inteira;
 *   - `"valor": {}` — um `z.unknown()` emite schema SEM `type`, recusado.
 *
 * Nenhum teste daqui chama um provedor de verdade, então a única forma de
 * vigiar isto é medir o JSON Schema que sai — que é exatamente o artefato que
 * o provedor recebe. Um teste sobre o objeto Zod não veria nada: o Zod aceita
 * recursão e `unknown` sem reclamar, e foi por isso que o defeito passou.
 *
 * O que este arquivo NÃO promete: que o schema seja aceito por todo provedor.
 * Ele prova a ausência das duas formas que já quebraram em produção. As demais
 * incompatibilidades do modo estrito (`oneOf`, `default` fora de `required`,
 * raiz sem `additionalProperties`) são tratadas desligando o modo estrito na
 * rota — ver `providerOptions` em `app/api/v1/flows/[id]/ai/gerar/route.ts`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { montarSchemaDeGeracao } from "./generation-schema";

function jsonSchemaDeGeracao(): Record<string, unknown> {
  return z.toJSONSchema(montarSchemaDeGeracao(), { io: "input" }) as Record<string, unknown>;
}

describe("o JSON Schema entregue ao provedor", () => {
  /**
   * A forma que derrubou o passo em produção, com dois modelos de fabricantes
   * diferentes respondendo o mesmo "Provider returned error".
   *
   *   z.discriminatedUnion(...)  ->  oneOf   ← recusado
   *   z.union(...)               ->  anyOf   ← aceito
   *
   * Structured Outputs de APIs compatíveis com OpenAI aceita `anyOf` e recusa
   * `oneOf`. E `strictJsonSchema: false` NÃO salva: ele afrouxa `required` e
   * `additionalProperties`, e não troca a palavra-chave da união — foi
   * exatamente por isso que a correção anterior não bastou.
   */
  it("não tem `oneOf` em lugar nenhum — só `anyOf` é aceito", () => {
    const texto = JSON.stringify(jsonSchemaDeGeracao());
    expect(
      texto.includes('"oneOf"'),
      "voltou a haver `oneOf`. Alguém trocou um z.union por z.discriminatedUnion, " +
        "ou um configSchema de nó com discriminatedUnion entrou na geração sem override " +
        "em CONFIG_PARA_GERACAO. Ver o cabeçalho de generation-schema.ts.",
    ).toBe(false);

    // O contraprova: a união existe, e existe na forma certa.
    expect(texto.includes('"anyOf"'), "a união sumiu inteira — isso não é o conserto").toBe(true);
  });

  it("não tem $ref nem $defs — recursão quebra provedores de saída estruturada", () => {
    const texto = JSON.stringify(jsonSchemaDeGeracao());

    expect(
      texto.includes('"$ref"'),
      "o schema voltou a ter $ref. Veio de um z.lazy/recursivo (provavelmente " +
        "grupoSchema em logic.if). Use um subconjunto NÃO recursivo em " +
        "CONFIG_PARA_GERACAO — ver o cabeçalho de generation-schema.ts.",
    ).toBe(false);

    expect(texto.includes('"$defs"'), "o schema voltou a ter $defs").toBe(false);
  });

  it("nenhuma PROPRIEDADE tem schema vazio — `{}` é recusado por modo estrito", () => {
    // `z.unknown()`/`z.any()` emitem `{}`: sem `type`, sem nada. O provedor não
    // sabe o que pedir ao modelo, e o modo estrito rejeita de saída.
    //
    // A checagem é estrutural, e não textual, porque `"properties": {}` é
    // legítimo — é como sai um nó sem nenhuma config (`trigger.lead_created`).
    // Um regex sobre o texto confunde os dois; foi o primeiro desenho deste
    // teste e ele reprovava um schema correto.
    const vazias: string[] = [];

    function andar(no: unknown, caminho: string): void {
      if (typeof no !== "object" || no === null) return;
      const obj = no as Record<string, unknown>;

      const props = obj.properties;
      if (typeof props === "object" && props !== null) {
        for (const [nome, valor] of Object.entries(props as Record<string, unknown>)) {
          if (
            typeof valor === "object" &&
            valor !== null &&
            Object.keys(valor as object).length === 0
          ) {
            vazias.push(`${caminho}.${nome}`);
          }
        }
      }

      for (const [chave, valor] of Object.entries(obj)) {
        if (Array.isArray(valor)) valor.forEach((v, i) => andar(v, `${caminho}.${chave}[${i}]`));
        else andar(valor, `${caminho}.${chave}`);
      }
    }

    andar(jsonSchemaDeGeracao(), "raiz");

    expect(
      vazias,
      `propriedade(s) com schema vazio: ${vazias.join(", ")}. Alguma passou a usar ` +
        `z.unknown()/z.any(); tipe-a explicitamente no schema de geração.`,
    ).toEqual([]);
  });

  /**
   * A garantia que torna o subconjunto seguro: o que a IA pode gerar tem de ser
   * aceito pelo runtime SEM tradução. Se esta relação se romper, o fluxo é
   * gerado, exibido, e falha na hora de rodar — que é bem pior que falhar agora.
   */
  it("o que a geração permite em logic.if é aceito pelo schema de RUNTIME", async () => {
    const { ifConfigSchema } = await import("../nodes/logica");

    const gerado = {
      saidas: [
        {
          id: "quente",
          label: "Lead quente",
          quando: {
            combinador: "and" as const,
            itens: [
              { campo: "lead.score", op: "gte" as const, valor: 80 },
              { campo: "lead.origem", op: "eq" as const, valor: "site" },
            ],
          },
        },
      ],
    };

    expect(ifConfigSchema.safeParse(gerado).success).toBe(true);
  });

  it("continua havendo 11 tipos de nó — o subconjunto não pode ESCONDER blocos", () => {
    // Simplificar o config de um nó é aceitável; sumir com um tipo inteiro do
    // vocabulário da IA não é — ela deixaria de saber que o bloco existe.
    const schema = montarSchemaDeGeracao();
    const json = jsonSchemaDeGeracao();
    const props = json.properties as Record<string, Record<string, unknown>> | undefined;
    const items = props?.nodes?.items as Record<string, unknown[]> | undefined;
    const variantes = items?.anyOf ?? items?.oneOf;

    expect(Object.keys(schema.shape).sort()).toEqual(["edges", "nodes"]);
    expect(variantes ?? [], "a lista de variantes de nó sumiu do schema").not.toEqual([]);
    expect(variantes?.length ?? 0).toBeGreaterThanOrEqual(11);
  });
});
