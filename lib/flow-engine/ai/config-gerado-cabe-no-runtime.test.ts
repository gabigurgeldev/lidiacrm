/**
 * O EXEMPLO DE CADA TIPO PRECISA VALER NOS DOIS LADOS.
 *
 * `configExemploDoTipo` deixou de ser só ilustração no prompt: na geração por
 * etapas ele é o VALOR DE QUEDA — o config que o bloco recebe quando a chamada
 * daquele bloco falha. Um exemplo inválido, que antes só ensinava um padrão
 * ruim ao modelo, agora vai direto para o editor da pessoa, e o bloco nasce sem
 * saídas: não há onde ligar a primeira linha, e nada acusa.
 *
 * Dois lados, porque são dois contratos diferentes e ambos precisam aceitar:
 *   - o schema de GERAÇÃO (o subconjunto oferecido ao modelo);
 *   - o `configSchema` de RUNTIME (o que o motor executa).
 *
 * A cerca antiga fazia isso só para `logic.if`. O caso que ela não cobria é o
 * que dói: um tipo cujo `branches()` não lê `config` aceita exemplo inválido em
 * silêncio — foi assim que `crm.add_tag` e `notify.internal` ficaram com
 * exemplo vazio por meses, contra um schema que exige `min(1)`.
 */
import { describe, expect, it } from "vitest";

import { schemaDeConfigParaGeracao } from "./config-para-geracao";
import { configExemploDoTipo } from "../node-examples";
import { garantirNosRegistrados } from "../register-all";
import { buscarNo, tiposRegistrados } from "../registry";

function tipos(): string[] {
  garantirNosRegistrados();
  return tiposRegistrados();
}

describe("o exemplo de config de cada tipo", () => {
  it.each(tipos())("%s: passa no configSchema de RUNTIME", (tipo) => {
    const def = buscarNo(tipo);
    expect(def, `${tipo} não está registrado`).toBeDefined();

    const lido = def!.configSchema.safeParse(configExemploDoTipo(tipo));
    expect(
      lido.success,
      `${tipo}: o exemplo NÃO passa no schema de runtime — ${
        lido.success ? "" : JSON.stringify(lido.error.issues.slice(0, 3))
      }. Este exemplo é o valor de queda da geração: inválido, ele chega ao editor ` +
        `da pessoa e o bloco nasce sem saídas.`,
    ).toBe(true);
  });

  it.each(tipos())("%s: passa também no schema de GERAÇÃO", (tipo) => {
    const schema = schemaDeConfigParaGeracao(tipo);
    if (schema === null) return; // tipo sem campo nenhum: nada a validar

    const lido = schema.safeParse(configExemploDoTipo(tipo));
    expect(
      lido.success,
      `${tipo}: o exemplo não passa no subconjunto oferecido ao modelo — ${
        lido.success ? "" : JSON.stringify(lido.error.issues.slice(0, 3))
      }. Ou o exemplo usa uma forma que a geração não oferece, ou o subconjunto ` +
        `ficou estreito demais.`,
    ).toBe(true);
  });

  it.each(tipos())("%s: o que a GERAÇÃO permite é aceito pelo RUNTIME", (tipo) => {
    const schema = schemaDeConfigParaGeracao(tipo);
    if (schema === null) return;

    // A regra que torna o subconjunto seguro: gerado -> runtime, sem tradução.
    const gerado = schema.parse(configExemploDoTipo(tipo));
    const def = buscarNo(tipo)!;
    const lido = def.configSchema.safeParse(gerado);
    expect(
      lido.success,
      `${tipo}: o subconjunto de geração produziu um valor que o RUNTIME recusa. ` +
        `O subconjunto tem de ser ESTRITO: tudo que a IA pode gerar precisa executar.`,
    ).toBe(true);
  });
});
