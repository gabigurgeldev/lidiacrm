/**
 * A PÁGINA PÚBLICA DE PAREAMENTO É PÚBLICA DE VERDADE?
 *
 * ## O defeito que este arquivo existe para impedir
 *
 * A feature foi escrita inteira — rota autenticada que gera, duas rotas
 * públicas, página, componente — e 11 testes unitários verdes sobre a regra de
 * validade do link. Nada disso tocava o `proxy.ts`, que é quem decide o que
 * exige sessão. Em produção, medido:
 *
 *     /pair/<token>                → 307 (redireciona para o login)
 *     /api/v1/pair/<token>/status  → 401 unauthenticated
 *
 * A página "pública" não era pública para ninguém. O cliente do outro lado
 * receberia um convite para logar num CRM que não é dele.
 *
 * Um teste sobre `lerLinkDePareamento` nunca acharia isso: o proxy não roda
 * neles. Este arquivo testa a CAMADA que faltava — a lista de caminhos que
 * dispensam sessão — e é a razão de ele existir separado.
 *
 * ## A outra metade: o que NÃO pode entrar de carona
 *
 * Abrir caminho público é a mudança mais fácil de errar para o lado permissivo,
 * e a que ninguém revisa duas vezes. Por isso os casos negativos são metade do
 * arquivo: a rota que GERA o link (onde a sessão é o que impede um estranho de
 * criar links para a sua linha) tem de continuar exigindo sessão.
 */
import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";

const TOKEN = "a".repeat(48);

describe("o pareamento por link dispensa sessão", () => {
  it("⭐ a página que o cliente abre é pública", () => {
    expect(isPublicPath(`/pair/${TOKEN}`)).toBe(true);
  });

  it("⭐ o status e o QR são públicos — são o que a página consome", () => {
    expect(isPublicPath(`/api/v1/pair/${TOKEN}/status`)).toBe(true);
    expect(isPublicPath(`/api/v1/pair/${TOKEN}/qr`)).toBe(true);
  });
});

describe("o que NÃO entra de carona", () => {
  it("⭐ GERAR o link continua exigindo sessão", () => {
    // É a sessão que impede um estranho de criar links para a SUA linha. Se
    // esta rota virasse pública, todo o resto do desenho perderia o sentido.
    expect(isPublicPath("/api/v1/channel-sessions/abc-123/pairing-link")).toBe(false);
  });

  it("⭐ sub-path futuro sob /pair não nasce público", () => {
    // A âncora `$` é o que garante isto. `/^\/pair\//` deixaria qualquer coisa
    // futura entrar sozinha — a mesma armadilha que as entradas do OAuth e de
    // `/legal/` já documentam.
    expect(isPublicPath(`/pair/${TOKEN}/admin`)).toBe(false);
    expect(isPublicPath(`/api/v1/pair/${TOKEN}/revogar`)).toBe(false);
    expect(isPublicPath(`/api/v1/pair/${TOKEN}/status/interno`)).toBe(false);
  });

  it("⭐ /pair sem token não é caminho público", () => {
    expect(isPublicPath("/pair")).toBe(false);
    expect(isPublicPath("/pair/")).toBe(false);
  });

  it("o inbox e a tela de canais seguem privados — controle da sonda", () => {
    // Sem este controle, uma `isPublicPath` que devolvesse `true` para tudo
    // passaria nos casos positivos acima e o arquivo mediria nada.
    expect(isPublicPath("/app/inbox")).toBe(false);
    expect(isPublicPath("/app/settings/connections")).toBe(false);
  });
});
