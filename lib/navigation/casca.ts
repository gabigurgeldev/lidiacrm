/**
 * Onde a casca do app se apaga para a tela respirar.
 *
 * ═══ Por que uma função, e não um `pathname.startsWith` em cada lugar ═══
 *
 * A resposta é lida em DOIS lugares que precisam concordar sempre: a casca
 * (`AppShell`), que decide não desenhar o cabeçalho, e o rodapé da barra lateral
 * (`SidebarFooter`), que decide adotar as ações de conta que o cabeçalho
 * deixou órfãs. Se os dois divergirem, o resultado não é um erro — é o sino e o
 * avatar aparecendo DUAS vezes na tela, ou NENHUMA. As duas falhas são mudas.
 *
 * ═══ Só o Inbox, e só por enquanto ═══
 *
 * O Inbox é a única tela em que a barra superior compete com o conteúdo: ela é
 * uma conversa que quer a altura toda, com a própria linha de ações (Assumir,
 * Transferir, Fechar) logo abaixo — duas barras empilhadas fazendo trabalhos
 * diferentes. Nas demais telas o cabeçalho é onde se está e o que se busca, e
 * tirá-lo seria tirar orientação sem ganhar nada.
 */

/** Rotas cuja tela pede a altura inteira. Prefixo, para cobrir `/app/inbox/<id>`. */
const SEM_CABECALHO = ["/app/inbox"] as const;

/**
 * ⚠️ ESTA RESPOSTA VALE SÓ A PARTIR DE `md`. No celular o cabeçalho FICA, e não
 * é exceção cosmética: o botão ☰ que abre a gaveta de navegação mora dentro
 * dele, e a barra lateral é `hidden md:block`. Escondê-lo lá deixaria as vinte
 * telas do produto alcançáveis só digitando a URL.
 *
 * Quem aplica o corte por largura é o CSS (`md:hidden` no invólucro do
 * cabeçalho), não esta função: medida de largura em JavaScript só existe depois
 * da hidratação, e estrutura decidida assim pisca no primeiro render.
 */
export function cabecalhoEscondidoEm(pathname: string): boolean {
  return SEM_CABECALHO.some((rota) => pathname === rota || pathname.startsWith(rota + "/"));
}

/**
 * A mesma pergunta, para o padding: a tela que dispensa o cabeçalho também
 * dispensa a margem do `<main>` — ela é de borda a borda, como o WhatsApp Web.
 *
 * Um alias e não uma segunda lista: são a mesma decisão vista de dois ângulos, e
 * duas listas divergiriam no dia em que uma tela nova entrasse em só uma delas.
 */
export const conteudoSemMargemEm = cabecalhoEscondidoEm;
