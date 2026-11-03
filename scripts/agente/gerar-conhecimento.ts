/**
 * Gera `agente/conhecimento.gerado.ts` — a base de conhecimento da assistente
 * de suporte in-app. Roda no `prebuild` (`pnpm build`), e à mão:
 *
 *   pnpm exec tsx scripts/agente/gerar-conhecimento.ts
 *
 * Lê SÓ duas fontes (allowlist): `lib/navigation/registry.ts` e
 * `agente/conhecimento/*.md`. A regra de montagem mora em
 * `agente/conhecimento/montar.ts`.
 *
 * Não falha o build quando falta página: AVISA. Quem reprova é o teste
 * `tests/unit/agente-conhecimento.test.ts`, no CI — um build de emergência na
 * VPS não pode morrer porque alguém esqueceu um parágrafo de manual.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conferir, montarConhecimento, type PaginaDoManual } from "../../agente/conhecimento/montar";
import { NAV_DESTINATIONS, NAV_GROUPS } from "../../lib/navigation/registry";

const RAIZ = join(__dirname, "..", "..");
const PASTA = join(RAIZ, "agente", "conhecimento");
const SAIDA = join(RAIZ, "agente", "conhecimento.gerado.ts");

const paginas: PaginaDoManual[] = readdirSync(PASTA)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((arquivo) => ({ arquivo, conteudo: readFileSync(join(PASTA, arquivo), "utf8") }));

const texto = montarConhecimento(NAV_GROUPS, NAV_DESTINATIONS, paginas);
const c = conferir(NAV_GROUPS, NAV_DESTINATIONS, paginas);

const conteudo = `// GERADO por scripts/agente/gerar-conhecimento.ts — NÃO EDITE À MÃO.
// Fonte: lib/navigation/registry.ts + agente/conhecimento/*.md.
// Para mudar o que a assistente sabe, edite os .md e rode o script (ou \`pnpm build\`).
export const CONHECIMENTO = ${JSON.stringify(texto)};
`;
writeFileSync(SAIDA, conteudo, "utf8");

const avisos: string[] = [
  ...c.rotasSemPagina.map((r) => `tela do menu sem página no manual: ${r}`),
  ...c.rotasInexistentes.map((x) => `${x.arquivo} cita rota que não está no menu: ${x.rota}`),
  ...c.paginasSemRotas.map((a) => `${a} não tem a linha "Rotas:"`),
];
for (const a of avisos) process.stderr.write(`[agente/conhecimento] AVISO: ${a}\n`);
process.stdout.write(
  `[agente/conhecimento] ${paginas.length} páginas, ${texto.length} caracteres → agente/conhecimento.gerado.ts` +
    (avisos.length ? ` (${avisos.length} aviso(s))` : "") +
    "\n",
);
