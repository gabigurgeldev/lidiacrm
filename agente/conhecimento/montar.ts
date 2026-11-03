/**
 * Monta a base de conhecimento da assistente: o mapa do menu (tirado do
 * CÓDIGO, `lib/navigation/registry.ts`) + o manual curado (`*.md` desta pasta).
 *
 * Puro de propósito — sem `fs`. Quem lê os arquivos e grava
 * `agente/conhecimento.gerado.ts` é `scripts/agente/gerar-conhecimento.ts` (no
 * `prebuild`); quem confere que o gerado não envelheceu é
 * `tests/unit/agente-conhecimento.test.ts`, com esta MESMA função.
 *
 * ── Por que o menu vem do código e não do manual ────────────────────────────
 *
 * O manual é escrito por gente e envelhece; o registro de navegação é o que a
 * barra lateral desenha. Uma tela nova entra no mapa no dia em que entra no
 * menu, mesmo que ninguém escreva a página dela — e o teste reprova enquanto a
 * página não existir, que é o lembrete de escrever.
 *
 * ── Allowlist de fonte ──────────────────────────────────────────────────────
 *
 * O texto que chega ao cliente sai SÓ de duas fontes: o registro de navegação
 * (rótulo, descrição, grupo, papel mínimo) e os `.md` desta pasta. Nunca
 * CLAUDE.md, migrations, docs internas nem código de segurança — o que entra no
 * prompt pode sair numa resposta.
 */
import type { NavDestination, NavGroup } from "@/lib/navigation/registry";

export interface PaginaDoManual {
  arquivo: string;
  conteudo: string;
}

export interface Conferencia {
  /** Rotas do menu que nenhuma página declara na linha `Rotas:`. */
  rotasSemPagina: string[];
  /** Rotas declaradas em alguma página que não existem mais no menu. */
  rotasInexistentes: Array<{ arquivo: string; rota: string }>;
  /** Páginas sem a linha `Rotas:`. */
  paginasSemRotas: string[];
}

const QUEM_VE: Record<string, string> = {
  viewer: "todos",
  agent: "atendente ou acima",
  manager: "gerente ou admin",
  admin: "só admin",
};

/** As rotas que uma página declara cobrir: `Rotas: /app/a, /app/b`. */
export function rotasDaPagina(conteudo: string): string[] | null {
  const linha = /^Rotas:\s*(.+)$/m.exec(conteudo);
  if (!linha) return null;
  return linha[1]!
    .split(",")
    .map((r) => r.trim().replace(/`/g, ""))
    .filter(Boolean);
}

/** Toda rota do menu: as telas e os hubs dos grupos. */
export function rotasDoMenu(grupos: readonly NavGroup[], destinos: readonly NavDestination[]): string[] {
  const hubs = grupos.flatMap((g) => (g.hub ? [g.hub.href] : []));
  return [...new Set([...hubs, ...destinos.map((d) => d.href)])];
}

export function conferir(
  grupos: readonly NavGroup[],
  destinos: readonly NavDestination[],
  paginas: readonly PaginaDoManual[],
): Conferencia {
  const menu = new Set(rotasDoMenu(grupos, destinos));
  const cobertas = new Set<string>();
  const rotasInexistentes: Conferencia["rotasInexistentes"] = [];
  const paginasSemRotas: string[] = [];

  for (const p of paginas) {
    const rotas = rotasDaPagina(p.conteudo);
    if (!rotas) {
      paginasSemRotas.push(p.arquivo);
      continue;
    }
    for (const r of rotas) {
      if (menu.has(r)) cobertas.add(r);
      else rotasInexistentes.push({ arquivo: p.arquivo, rota: r });
    }
  }

  return {
    rotasSemPagina: [...menu].filter((r) => !cobertas.has(r)).sort(),
    rotasInexistentes,
    paginasSemRotas,
  };
}

/** O mapa do menu em texto: grupo → telas, com caminho, descrição e quem vê. */
export function mapaDoMenu(grupos: readonly NavGroup[], destinos: readonly NavDestination[]): string {
  const linhas: string[] = ["# Mapa do menu (gerado do código — sempre atual)", ""];
  linhas.push(
    "Telas com (barra lateral) aparecem direto na barra da esquerda; as demais ficam dentro da página do grupo " +
      "(hub). No celular, a barra abre pelo botão ☰ no topo.",
    "",
  );
  for (const g of grupos) {
    linhas.push(`## ${g.label}${g.hub ? ` — hub "${g.hub.label}" em ${g.hub.href}` : ""}`);
    for (const d of destinos.filter((x) => x.group === g.id)) {
      const onde = d.sidebar ? " (barra lateral)" : "";
      const secao = d.section ? ` [seção ${d.section}]` : "";
      linhas.push(
        `- **${g.label} › ${d.label}**${onde}${secao} — ${d.href} — quem vê: ${QUEM_VE[d.minRole ?? "viewer"]}. ${d.description}`,
      );
    }
    linhas.push("");
  }
  return linhas.join("\n");
}

/** O texto final que vai ao system prompt. Ordem estável: menu, depois páginas por nome de arquivo. */
export function montarConhecimento(
  grupos: readonly NavGroup[],
  destinos: readonly NavDestination[],
  paginas: readonly PaginaDoManual[],
): string {
  const ordenadas = [...paginas].sort((a, b) => a.arquivo.localeCompare(b.arquivo));
  return [
    mapaDoMenu(grupos, destinos).trimEnd(),
    ...ordenadas.map((p) => p.conteudo.replace(/\r\n/g, "\n").trim()),
  ].join("\n\n---\n\n");
}
