/**
 * O ENDEREÇO PÚBLICO DESTA INSTALAÇÃO — a regra, num lugar só.
 *
 * ═══ O defeito que este módulo existe para fechar ═══
 *
 * `NEXT_PUBLIC_*` é substituída no BUILD, e a imagem genérica do self-host é
 * construída com `https://placeholder.invalid` (Dockerfile, `ARG
 * NEXT_PUBLIC_APP_URL`). Uma rota que lê `process.env.NEXT_PUBLIC_APP_URL` e
 * confia no valor monta endereços que não resolvem — e o sintoma aparece longe
 * de quem escreveu o código: um webhook registrado no nada, ou um link que o
 * cliente abre no celular e não carrega.
 *
 * Medido em produção (2026-09-10): o link público de pareamento saía como
 * `https://placeholder.invalid/pair/<token>`. A tela mostrava o link com ar de
 * pronto, o botão "Copiar" copiava, e o cliente do outro lado recebia um
 * endereço morto. Nada quebrava, nenhum erro em lugar nenhum.
 *
 * ═══ O SEGUNDO valor inútil, que o filtro anterior deixava passar ═══
 *
 * `env.NEXT_PUBLIC_APP_URL` tem `.default("http://localhost:3000")`. Numa
 * instalação que não define a variável, a base "configurada" é localhost — que
 * para um link destinado ao celular de OUTRA pessoa é tão inútil quanto o
 * placeholder, e passava batido em qualquer filtro que só olhasse
 * `placeholder.invalid`.
 *
 * Por isso a regra tem duas metades, e a segunda é condicional: localhost só é
 * descartado quando a requisição chega por OUTRO host. Em desenvolvimento — em
 * que a requisição também chega por localhost — ele é a resposta certa, e
 * descartá-lo sempre quebraria o ambiente de quem desenvolve para consertar o
 * de quem instala.
 *
 * ═══ Por que um módulo, e não uma função dentro da rota ═══
 *
 * Porque a mesma regra já existe copiada em três lugares
 * (`lib/channels/conta-de-instancias.ts`, `app/api/v1/channels/partner`,
 * `app/api/v1/channels/official`) — e a rota do link de pareamento é justamente
 * a que NÃO recebeu a cópia: ela lia `process.env` direto. Uma quarta cópia
 * repetiria o modo de falha; um módulo dá às três um lugar para onde migrar.
 *
 * ⚠️ As três cópias seguem existindo: migrá-las é mudança de comportamento em
 * rotas de canal e OAuth, fora do escopo desta correção, e vale a pena fazer com
 * o teste de cada uma à mão. Este módulo é o destino delas, não o registro de
 * que já chegaram.
 */
import { env } from "@/lib/env";

/** O bastante para montar a base a partir da própria requisição. */
export interface RequisicaoComOrigem {
  headers: Headers;
  nextUrl: { protocol: string; host: string };
}

/** Hosts que só existem na máquina de quem roda — inúteis num link que viaja. */
function ehLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    // String que não é URL não é um endereço local: é um endereço inválido, e
    // quem decide isso é `baseConfiguradaUsavel`.
    return false;
  }
}

/**
 * A base que o operador configurou, SE ela servir para alguém de fora abrir.
 *
 * Exportada para teste: é a metade da regra que não depende de requisição
 * nenhuma, e medir as duas juntas exigiria forjar `Headers` para provar coisas
 * sobre uma string.
 */
export function baseConfiguradaUsavel(configurada: string | undefined): string | null {
  if (!configurada) return null;
  if (configurada.includes("placeholder.invalid")) return null;
  return configurada.replace(/\/+$/, "");
}

/** Por onde a requisição chegou — a melhor pista quando a variável falta. */
function baseDaRequisicao(req: RequisicaoComOrigem): string {
  const origem = req.headers.get("origin");
  if (origem) return origem.replace(/\/+$/, "");
  return `${req.nextUrl.protocol}//${req.nextUrl.host}`.replace(/\/+$/, "");
}


/**
 * O endereço público desta instalação, sem barra no fim.
 *
 * Ordem de preferência:
 *   1. `NEXT_PUBLIC_APP_URL`, quando ela serve (ver acima);
 *   2. o host por onde a requisição chegou.
 *
 * Com a exceção do localhost: uma base configurada como localhost perde para um
 * host de requisição que NÃO é localhost, porque nesse caso a variável está
 * claramente no default e o host real é a informação melhor.
 */
export function basePublica(req: RequisicaoComOrigem): string {
  const configurada = baseConfiguradaUsavel(env.NEXT_PUBLIC_APP_URL);
  const daRequisicao = baseDaRequisicao(req);

  if (configurada === null) return daRequisicao;
  if (ehLocal(configurada) && !ehLocal(daRequisicao)) return daRequisicao;
  return configurada;
}
