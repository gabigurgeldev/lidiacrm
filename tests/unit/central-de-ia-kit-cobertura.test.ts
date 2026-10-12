/**
 * Catraca do redesign da Central de IA: o design antigo só sai, nunca volta.
 *
 * Duas medidas sobre `app/app/ai/`:
 *
 *  1. **Toda página usa o cabeçalho do kit** (`<PaginaAjustes>`), direto ou por
 *     um componente que a página delega (`DELEGA`, conferido: o componente
 *     PRECISA conter o `<PaginaAjustes>`). O que fica de fora está em
 *     `SEM_KIT`, com o motivo escrito.
 *  2. **O cartão antigo (`<Card>` de `@/components/ui/card`) não cresce.** A
 *     superfície do kit é o `Grupo` (ou a classe `.ios-grupo`). `LEGADO` guarda
 *     quantos `<Card` cada arquivo ainda tem; arquivo fora dela tem zero, e o
 *     número de quem está nela só pode descer.
 *
 * As três listas só encolhem, e o último caso reprova entrada morta — quem
 * converte uma tela tira a linha daqui no mesmo PR.
 *
 * Complementa `central-de-ia-no-kit.test.ts` (que reprova `<h1>` feito à mão).
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.join(process.cwd(), "app/app/ai");

/** Página → componente que monta a tela inteira (e o `<PaginaAjustes>`). */
const DELEGA: Record<string, string> = {
  "app/app/ai/page.tsx": "components/shell/NavHub.tsx",
  "app/app/ai/runs/page.tsx": "app/app/ai/runs/_components/ExecucoesDeIa.tsx",
  "app/app/ai/providers/page.tsx": "app/app/ai/providers/_components/PainelDeProvedores.tsx",
};

/** Páginas sem o cabeçalho do kit, e por quê. */
const SEM_KIT: Record<string, string> = {
  "app/app/ai/followups/[id]/page.tsx":
    "construtor de fluxo em tela cheia (canvas React Flow): o cabeçalho é a barra de publicar, não um título",
  "app/app/ai/followups/enrollments/[id]/page.tsx":
    "dossiê de UM contato no follow-up: o título é o dado (nome do contato), montado no DossieDoFollowup",
  "app/app/ai/integracoes/[id]/page.tsx":
    "detalhe de UMA integração: o título é o nome dela, montado no PainelDaIntegracao",
  "app/app/ai/agents/criar-com-ia/page.tsx":
    "reescrita no PR do construtor em conversa (feat/construtor-em-chat), que já a põe no kit — sai daqui quando ele entrar",
};

/** Arquivo → quantos `<Card` ainda tem. Só desce. */
const LEGADO: Record<string, number> = {
  // Reescrito no PR do construtor em conversa (Revisao/Anexos já no kit); 10 = 9 + o cartão do coordenador.
  "app/app/ai/agents/criar-com-ia/_client.tsx": 10,
};

function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx") ? [p] : [];
  });
}

const relativo = (p: string) => path.relative(process.cwd(), p).split(path.sep).join("/");
const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const cartoes = (fonte: string) => (fonte.match(/<Card[\s>]/g) ?? []).length;

describe("Central de IA: catraca do kit de Ajustes", () => {
  const todos = arquivos(RAIZ).map(relativo);
  const paginas = todos.filter((f) => f.endsWith("/page.tsx"));

  it("a varredura enxerga as telas (guarda de vacuidade)", () => {
    expect(paginas.length).toBeGreaterThanOrEqual(20);
  });

  it("toda página usa <PaginaAjustes>, direto ou pelo componente que delega", () => {
    const fora = paginas.filter((p) => {
      if (SEM_KIT[p] !== undefined) return false;
      if (ler(p).includes("<PaginaAjustes")) return false;
      const delegado = DELEGA[p];
      return delegado === undefined || !ler(delegado).includes("<PaginaAjustes");
    });
    expect(fora, "envolva a tela em <PaginaAjustes titulo descricao> de @/components/ajustes").toEqual([]);
  });

  it("o <Card> antigo não volta nem cresce", () => {
    const excessos = todos.flatMap((f) => {
      const n = cartoes(ler(f));
      const teto = LEGADO[f] ?? 0;
      return n > teto ? [`${f}: ${n} <Card (teto ${teto})`] : [];
    });
    expect(excessos, "use Grupo/Linha de @/components/ajustes (ou a classe ios-grupo)").toEqual([]);
  });

  it("as listas não guardam entrada morta", () => {
    const mortas = [
      ...Object.keys(SEM_KIT).filter((p) => !fs.existsSync(p) || ler(p).includes("<PaginaAjustes")),
      ...Object.keys(DELEGA).filter((p) => !fs.existsSync(p) || ler(p).includes("<PaginaAjustes")),
      ...Object.entries(LEGADO)
        .filter(([f, teto]) => !fs.existsSync(f) || cartoes(ler(f)) < teto)
        .map(([f, teto]) => `${f} (teto ${teto}, tem ${fs.existsSync(f) ? cartoes(ler(f)) : 0}: baixe o teto)`),
    ];
    expect(mortas).toEqual([]);
  });
});
