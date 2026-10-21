import { ehRedirectDoNext } from "@/lib/auth/redirect-do-next";

/**
 * Chama a ação de sair e, se ela FALHAR, leva ao `/login` mesmo assim.
 *
 * Antes, uma rejeição da Server Action (GoTrue em 504, rede caída, ou o chunk
 * do `import()` dinâmico que sumiu depois de um deploy) subia até
 * `app/app/error.tsx`: a pessoa clicava em "Sair" e via uma tela de erro. Quem
 * pediu para sair sai — a navegação completa para `/login` refaz o estado do
 * zero, e o próprio `/login` é público.
 *
 * O `redirect()` da ação chega aqui como sentinela lançado e é RELANÇADO: é a
 * navegação de sucesso, e engoli-lo deixaria a pessoa parada na tela.
 *
 * Dependências injetáveis para o teste; em produção quem chama passa a ação.
 */
export async function sairComFallback(
  acao: () => Promise<void>,
  irPara: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  try {
    await acao();
  } catch (err) {
    if (ehRedirectDoNext(err)) throw err;
    irPara("/login");
  }
}
