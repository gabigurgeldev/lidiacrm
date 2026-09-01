/**
 * A regra pura por trás dos grupos recolhíveis do sidebar.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e não só o teste de componente ao lado
 * (`sidebar-grupos.test.tsx`): MEDIDO. Sabotei `gruposIniciais` — apaguei a
 * linha que abre o grupo da rota — e a suíte do componente ficou INTEIRA VERDE,
 * 15 de 15. O motivo é que o componente tem duas metades para a mesma promessa:
 * esta função, que decide o PRIMEIRO render (o do servidor), e um `useEffect`
 * que reage a mudança de rota. No jsdom o efeito roda e conserta o estado antes
 * de qualquer asserção — então o teste de componente mede a segunda metade e diz
 * "verde" com a primeira quebrada.
 *
 * A primeira metade é justamente a que importa para quem usa: é ela que faz o
 * HTML do servidor já vir com o grupo certo aberto. Com ela quebrada, o produto
 * não erra o estado final — ele PISCA, abrindo o grupo depois da hidratação, em
 * toda navegação de página inteira. Um defeito que nenhum teste de componente
 * consegue ver, porque o jsdom não pinta.
 */
import { describe, expect, it } from "vitest";

import {
  COOKIE_GRUPOS,
  grupoDaRota,
  grupoPorPrefixoMaisLongo,
  gruposIniciais,
  lerGruposAbertos,
  serializarGrupos,
} from "@/lib/navigation/grupos-abertos";

describe("o cookie dos grupos", () => {
  it("distingue 'nunca escolheu' de 'fechou todos'", () => {
    // Os dois estados PRECISAM ser diferentes: com um valor só, quem fechou
    // todos os grupos veria a barra reabrir sozinha no próximo login — que é
    // exatamente a queixa que o recolhimento veio resolver.
    expect(lerGruposAbertos(undefined)).toBeNull();
    expect(lerGruposAbertos("")).toEqual([]);
  });

  it("descarta id que não existe mais, em vez de derrubar a navegação", () => {
    // O cookie de uma versão anterior pode citar um grupo que já não existe.
    // Confiar nele cegamente colocaria lixo no `Set` que o componente consulta.
    expect(lerGruposAbertos("canais,grupo-de-2024,crm")).toEqual(["canais", "crm"]);
    expect(lerGruposAbertos("nada-disso-existe")).toEqual([]);
  });

  it("vai e volta pelo mesmo formato", () => {
    const ida = serializarGrupos(["crm", "canais", "crm"]);
    expect(ida).toBe("crm,canais");
    expect(lerGruposAbertos(ida)).toEqual(["crm", "canais"]);
  });

  it("o nome do cookie é estável — o servidor e o navegador leem o mesmo", () => {
    // `app/app/layout.tsx` lê por esta constante e `gravarGruposAbertos` escreve
    // por ela. Uma string literal em qualquer um dos dois lados seria uma
    // preferência gravada que nunca mais é lida.
    expect(COOKIE_GRUPOS).toBe("nav_grupos_abertos");
  });
});

describe("o grupo da rota", () => {
  it("acha o grupo pelo destino exato", () => {
    expect(grupoDaRota("/app/inbox")).toBe("atendimento");
    expect(grupoDaRota("/app/webhooks")).toBe("canais");
  });

  it("as rotas aninhadas de Configurações acendem o grupo em que a tela mora", () => {
    // `/app/settings/tenant/pipelines` começa com `/app/settings`, que é o hub de
    // Organização — e as Etapas do funil moram em CRM.
    //
    // ⚠️ ESTE CASO NÃO SEPARA "prefixo mais longo" de "primeiro que casa", e eu
    // afirmei que separava até medir: sabotei a função para o primeiro casamento
    // e ele continuou verde, porque no registro de hoje o href mais longo já vem
    // primeiro no array. Ele é não-regressão do COMPORTAMENTO; quem guarda a
    // REGRA é o caso abaixo, com uma lista construída para isso.
    expect(grupoDaRota("/app/settings/tenant/pipelines")).toBe("crm");
    expect(grupoDaRota("/app/settings")).toBe("organizacao");
  });

  it("entre dois prefixos que casam, vence o MAIS LONGO — mesmo vindo depois", () => {
    // O registro é um array editado à mão e agrupado por jornada: a ordem dele é
    // de leitura, não de precedência. Uma reordenação inocente pôr o href curto
    // primeiro quebraria a navegação em silêncio se a regra fosse a ordem.
    const candidatos = [
      { href: "/app/settings", grupo: "organizacao" as const },
      { href: "/app/settings/tenant/pipelines", grupo: "crm" as const },
    ];
    expect(grupoPorPrefixoMaisLongo("/app/settings/tenant/pipelines", candidatos)).toBe("crm");
    expect(grupoPorPrefixoMaisLongo("/app/settings/billing", candidatos)).toBe("organizacao");
  });

  it("uma tela de detalhe acende o grupo da lista de onde ela veio", () => {
    expect(grupoDaRota("/app/ai/agents/f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe("ia");
  });

  it("rota fora do registro não inventa grupo", () => {
    expect(grupoDaRota("/app/nao-existe")).toBeNull();
    // ⚠️ E não casa por PREFIXO DE TEXTO: `/app/inboxeamento` não é `/app/inbox`.
    // Sem a barra no `startsWith`, uma rota futura com nome parecido acenderia o
    // grupo errado, e o defeito só apareceria quando essa rota nascesse.
    expect(grupoDaRota("/app/inboxeamento")).toBeNull();
  });
});

describe("o primeiro render", () => {
  it("sem cookie, abre só o grupo da rota", () => {
    expect([...gruposIniciais(null, "/app/inbox")]).toEqual(["atendimento"]);
  });

  it("com cookie, abre o que ele diz MAIS o grupo da rota", () => {
    // É esta união que garante a coisa mais simples: o item aceso é visível.
    // Sem ela, quem fechasse Canais e abrisse um link direto para /app/webhooks
    // veria uma barra sem nenhuma marca de onde está, e a única forma de
    // descobrir seria abrir grupo por grupo até achar o item aceso.
    const abertos = gruposIniciais(["crm"], "/app/webhooks");
    expect([...abertos].sort()).toEqual(["canais", "crm"]);
  });

  it("com cookie vazio, o grupo da rota abre mesmo assim", () => {
    expect([...gruposIniciais([], "/app/webhooks")]).toEqual(["canais"]);
  });

  it("numa rota que o registro não conhece, devolve o cookie sem inventar nada", () => {
    expect([...gruposIniciais(["crm"], "/app/nao-existe")]).toEqual(["crm"]);
  });
});
