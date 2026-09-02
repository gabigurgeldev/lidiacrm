/**
 * Invariante da matriz capability × provider (`docs/doctrine/restricao-de-canal.md`).
 *
 * Mora em `tests/unit/` — e não em `tests/invariants/` como o plano dizia — por
 * medição, não por gosto: `vitest.config.ts` EXCLUI `tests/invariants/**` do
 * `test:unit`, essa pasta só roda via `pnpm test:db` (Docker + Postgres efêmero) e
 * `.github/workflows/ci.yml` roda apenas typecheck + lint + `pnpm test:unit`. Um
 * teste de constante TypeScript lá dentro exigiria um banco para rodar e **nunca
 * reprovaria o CI** — o oposto do que o invariante 2 da doutrina promete.
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_CAPABILITIES,
  capabilitiesOf,
  CAPACIDADES_POR_MODO,
  type ChannelProvider,
} from "@/lib/channels/capabilities";

const PROVIDERS = [
  "waha",
  "meta_cloud",
  "zernio",
  "stevo",
] as const satisfies readonly ChannelProvider[];

/**
 * Esquecer um provider aqui passa a ser erro de COMPILAÇÃO.
 *
 * A lista era literal e solta: um canal novo entrava em `ChannelProvider` e na
 * matriz sem nunca ser varrido por este arquivo, e o teste seguia verde
 * afirmando exaustividade que não tinha. O tipo abaixo é `never` enquanto
 * sobrar provider fora da lista, e `tsc` reprova — antes do teste rodar.
 */
type ProviderNaoVarrido = Exclude<ChannelProvider, (typeof PROVIDERS)[number]>;
const _todoProviderEstaNaLista: ProviderNaoVarrido extends never ? true : never = true;
void _todoProviderEstaNaLista;
const CAPABILITIES = [
  "freeformOutsideWindow",
  "requiresTemplates",
  "canManageTemplates",
  "banRisk",
  "minIntervalMs",
  "voiceNote",
  "groups",
  "costPerMessage",
] as const;

describe("matriz capability × provider é exaustiva", () => {
  it("todo provider declara TODA capability", () => {
    for (const p of PROVIDERS) {
      for (const c of CAPABILITIES) {
        expect(CHANNEL_CAPABILITIES[p], `${p} não declara ${c}`).toHaveProperty(c);
      }
    }
  });

  it("nenhuma capability é declarada sem estar na lista (código morto)", () => {
    for (const p of PROVIDERS) {
      for (const key of Object.keys(CHANNEL_CAPABILITIES[p])) {
        expect(CAPABILITIES as readonly string[]).toContain(key);
      }
    }
  });

  it("resolução é fail-closed — provider desconhecido lança", () => {
    expect(() => capabilitiesOf("telegram" as ChannelProvider)).toThrow(/unknown_channel_provider/);
  });

  it("as duas famílias de restrição são mutuamente exclusivas por SESSÃO", () => {
    // auto-restrição (banRisk) e hetero-restrição (requiresTemplates) nunca coexistem:
    // é o que a doutrina restricao-de-canal.md afirma sobre a física dos canais.
    //
    // NÃO APAGUE ESTE CASO se ele ficar vermelho. Vermelho aqui significa que algum
    // canal passou a declarar as duas famílias — ou seja, que a tese central da
    // doutrina ("nenhuma é subconjunto da outra; elas convivem como regras irmãs")
    // encontrou um contraexemplo. O conserto é revisar a doutrina com o caso na mão
    // e decidir o que fazer quando as duas barram ao mesmo tempo (adiar? mudar a
    // forma da mensagem? escalar ao humano?), não silenciar o alarme que descobriu
    // a lacuna.
    //
    // ─── A REVISÃO QUE ESTE CASO PEDIU, feita com o contraexemplo na mão ──────
    //
    // O quarto canal apareceu e o alarme tocou. A tese da doutrina NÃO caiu: o
    // que caiu foi a unidade de análise. Ela era o PROVIDER, e passou a ser a
    // SESSÃO — porque esse canal hospeda, na mesma conta, instância oficial
    // (janela de 24h, sem risco de banimento) e número ligado por QR (texto
    // livre, com risco). Cada MODALIDADE respeita a exclusividade; o provider,
    // como unidade, deixou de ser a coisa certa a medir.
    //
    // Por isso a varredura mudou de forma: mede toda modalidade declarada, e
    // mede a linha do provider apenas para quem tem modalidade ÚNICA — que é
    // onde "a linha do provider" e "a sessão" são a mesma coisa.
    //
    // ─── E o fallback, que declara as duas de propósito ──────────────────────
    //
    // A linha de provider de um canal multi-modalidade é fallback: ela só é
    // consultada quando `provider_mode` não foi gravado (clone sem a migration
    // 0206). Ela é a conservadora em CADA eixo — não descreve instância real
    // nenhuma, e é isso que a faz declarar as duas famílias.
    //
    // O que acontece quando as duas barram ao mesmo tempo, que é a pergunta que
    // o parágrafo acima manda responder: o envio livre fora da janela é vetado
    // pelo `messagingWindowGate` E o ritmo é limitado pelo `pacingGate`. O
    // desfecho é "não sai agora", nunca "sai errado" — e é deliberado: o
    // fallback existe para não fazer estrago enquanto a modalidade é
    // desconhecida, não para adivinhar qual das duas famílias vale.
    const multiModalidade = new Set(Object.keys(CAPACIDADES_POR_MODO));

    for (const p of PROVIDERS) {
      const porModo = CAPACIDADES_POR_MODO[p];
      if (porModo) {
        for (const [modo, c] of Object.entries(porModo)) {
          expect(
            c.banRisk && c.requiresTemplates,
            `${p}/${modo} declara as duas famílias — é uma modalidade REAL, e aí a doutrina está mesmo contrariada`,
          ).toBe(false);
        }
        continue;
      }
      const c = CHANNEL_CAPABILITIES[p];
      expect(c.banRisk && c.requiresTemplates, `${p} declara as duas famílias`).toBe(false);
    }

    // Controle do instrumento: se a exceção do fallback deixar de existir (o
    // canal multi-modalidade sumir, ou passar a ter modalidade única), este
    // `continue` acima vira código morto e a varredura perde o ramo que ela
    // existe para cobrir — sem ninguém perceber.
    expect(multiModalidade.size, "nenhum canal multi-modalidade: o ramo por modo virou código morto").toBeGreaterThan(0);
  });
});
