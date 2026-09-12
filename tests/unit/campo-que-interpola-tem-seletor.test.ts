/**
 * CAMPO QUE ACEITA VARIÁVEL TEM DE OFERECER A LISTA.
 *
 * ─── O defeito que este guarda existe para não deixar voltar ────────────────
 *
 * Todo campo de bloco que passa por `ctx.render` aceita `{{lead.title}}` e
 * afins. Antes do seletor, a única pista disso era uma frase escrita à mão em
 * cada formulário — e as frases divergiam: a do bloco de aviso citava três
 * campos, a do bloco de envio citava outros três, e nenhuma mencionava
 * `{{vars.*}}`, que é metade do motivo de um fluxo ter mais de um bloco.
 *
 * O custo não é conveniência. `interpolar` troca marcador ausente por VAZIO de
 * propósito (mandar a chave crua ao cliente é pior que a lacuna), então
 * `{{lead.nome}}` — que não existe; o campo é `title` — sai como mensagem torta,
 * sem erro em lugar nenhum, para o cliente.
 *
 * ─── Por que ler o FONTE, e não montar as telas ─────────────────────────────
 *
 * Montar cada formulário exigiria um mundo de React Query, sessões e funis por
 * bloco — e mediria a renderização, que não é a pergunta. A pergunta é de
 * COMPLETUDE: existe bloco que interpola e formulário que não oferece? Isso se
 * responde no fonte, do mesmo jeito que `nodeFormRegistry.test.ts` responde
 * "existe tipo sem formulário?".
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORMULARIO_DO_TIPO } from "@/app/app/flows/[id]/_components/nodeFormRegistry";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { tiposRegistrados } from "@/lib/flow-engine/registry";

const DIR_DOS_NOS = path.join(process.cwd(), "lib/flow-engine/nodes");
const DIR_DOS_FORMULARIOS = path.join(process.cwd(), "app/app/flows/[id]/_components/forms");

/**
 * Tipos que interpolam e NÃO oferecem o seletor. Cada linha diz por quê, e a
 * lista só pode encolher — o mesmo contrato da allowlist de `lint:channels`.
 */
const SEM_SELETOR: Record<string, string> = {
  "flow.call":
    "O campo interpolado é `entrada` (o que se passa ao sub-fluxo), e ele ainda NÃO é editável " +
    "na tela: `FlowCallForm` só escolhe qual fluxo chamar. Não há campo onde pendurar o botão. " +
    "Sai desta lista no dia em que o editor de `entrada` existir.",
};

/** Cada `export const X: FlowNodeDefinition` abre um bloco; o `type` vem de dentro dele. */
function tiposQueInterpolam(): Set<string> {
  const achados = new Set<string>();
  for (const arquivo of fs.readdirSync(DIR_DOS_NOS)) {
    if (!arquivo.endsWith(".ts") || arquivo.endsWith(".test.ts")) continue;
    const fonte = fs.readFileSync(path.join(DIR_DOS_NOS, arquivo), "utf8");
    // O `execute` de cada bloco vive dentro da sua definição, então recortar por
    // definição é o que impede um `ctx.render` de um bloco ser cobrado do vizinho
    // — `paralelo.ts` tem cinco definições e só uma interpola.
    const pedacos = fonte.split(/export const \w+: FlowNodeDefinition/u).slice(1);
    for (const pedaco of pedacos) {
      const tipo = /\btype:\s*"([a-z_]+\.[a-z_]+)"/u.exec(pedaco)?.[1];
      if (tipo === undefined) continue;
      if (/ctx\.render\(/u.test(pedaco)) achados.add(tipo);
    }
  }
  return achados;
}

describe("o seletor de variáveis alcança todo campo que interpola", () => {
  it("⭐ a sonda enxerga os blocos de verdade — senão este arquivo passa vazio", () => {
    const tipos = tiposQueInterpolam();
    // Não é número mágico: é a prova de que o recorte por definição não quebrou.
    // Uma sonda que devolvesse conjunto vazio deixaria o teste abaixo verde e
    // sem sentido, que é o modo de falha clássico de guarda por varredura.
    expect(tipos.size).toBeGreaterThanOrEqual(6);
    expect(tipos.has("whatsapp.send_to_lead")).toBe(true);
    expect(tipos.has("logic.wait")).toBe(false);
  });

  it("⭐ todo bloco que interpola tem formulário COM o seletor", () => {
    garantirNosRegistrados();
    const registrados = new Set(tiposRegistrados());
    const faltando: string[] = [];

    for (const tipo of tiposQueInterpolam()) {
      if (!registrados.has(tipo)) continue;
      if (tipo in SEM_SELETOR) continue;

      const componente = FORMULARIO_DO_TIPO[tipo];
      expect(componente, `${tipo} interpola e não tem formulário nenhum`).toBeDefined();

      const arquivo = path.join(DIR_DOS_FORMULARIOS, `${componente!.name}.tsx`);
      const fonte = fs.readFileSync(arquivo, "utf8");
      if (!fonte.includes("CampoComVariavel")) faltando.push(`${tipo} (${componente!.name})`);
    }

    expect(faltando).toEqual([]);
  });

  it("⭐ a allowlist só vale para bloco que REALMENTE interpola", () => {
    // Uma dispensa que sobrevive ao campo que a justificava é pior que nenhuma:
    // ela vira permissão silenciosa para o próximo bloco com o mesmo nome.
    const interpolam = tiposQueInterpolam();
    const sobrando = Object.keys(SEM_SELETOR).filter((t) => !interpolam.has(t));
    expect(sobrando, "dispensa sem motivo: o bloco não interpola mais").toEqual([]);
  });

  it("⭐ o campo da regra do 'Decidir' usa o modo CAMINHO, não o de marcador", () => {
    // `condicoes.ts` RESOLVE `lead.score` como caminho — não interpola. Um
    // `{{lead.score}}` ali não dá erro: a condição devolve falso e o fluxo segue
    // pelo outro lado para sempre. É o tipo de defeito que nenhuma tela mostra.
    const fonte = fs.readFileSync(path.join(DIR_DOS_FORMULARIOS, "LogicIfForm.tsx"), "utf8");
    expect(fonte).toContain('modo="caminho"');
  });
});
