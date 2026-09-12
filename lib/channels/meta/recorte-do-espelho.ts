/**
 * QUAL COLUNA recorta o espelho de definições aprovadas — e por que não é a
 * que o nome sugere.
 *
 * ─── O defeito que esta função existe para não deixar voltar ────────────────
 *
 * `meta_templates` tem `channel_session_id` (migration 0154), então "mostre os
 * modelos DESTA conexão" parece ser `.eq("channel_session_id", id)`. Não é: o
 * caminho que espelha as definições do canal oficial (`template-sync.ts`)
 * chaveia por `(organization_id, waba_id, name, language)` e deixa
 * `channel_session_id` NULO — a 0154 chama isso de estado legítimo, porque
 * aquelas linhas vieram da WABA e ninguém sabe de qual número são.
 *
 * Medido: com o filtro por sessão, escolher o número no bloco de fluxo devolvia
 * ZERO linhas para toda organização do canal oficial, e a tela dizia "nenhum
 * modelo aprovado nesta conta" com o espelho cheio. O filtro mais específico
 * era o mais errado.
 *
 * ─── A regra certa é a da PLATAFORMA ────────────────────────────────────────
 *
 * Definição é aprovada por CONTA (WABA), e todos os números daquela conta
 * compartilham as mesmas. Então: recorta pela WABA quando se sabe qual é, e só
 * cai em `channel_session_id` para as linhas que o carregam — as que a rota do
 * canal intermediado espelha, que sempre o gravam.
 *
 * Função pura e separada porque o defeito foi de ESCOLHA DE COLUNA, e escolha
 * de coluna dentro de um encadeamento de query não tem onde ser testada.
 */

export interface RecorteDoEspelho {
  coluna: "waba_id" | "channel_session_id";
  valor: string;
}

export function recorteDoEspelho(input: {
  /** A conexão que o operador escolheu, quando escolheu alguma. */
  canalId: string | null;
  /** A WABA DAQUELA conexão, quando ela tem uma. */
  wabaDoCanal: string | null;
  /** A WABA da conexão oficial que a tela de Conexões sincroniza. */
  wabaDaSessao: string | null;
}): RecorteDoEspelho | null {
  // A WABA da conexão ESCOLHIDA ganha de tudo: é a resposta certa para "o que
  // posso usar neste número?", e é o que faz uma organização com duas contas
  // oficiais parar de ver sempre a lista da mais antiga.
  if (input.canalId !== null && input.wabaDoCanal !== null) {
    return { coluna: "waba_id", valor: input.wabaDoCanal };
  }
  // Conexão sem WABA conhecida: só as linhas que declaram a conexão servem.
  // Sem este ramo, um canal intermediado (cujo espelho SEMPRE grava a sessão)
  // cairia na lista da WABA de outro canal.
  if (input.canalId !== null) {
    return { coluna: "channel_session_id", valor: input.canalId };
  }
  // Sem conexão escolhida: o comportamento de antes do parâmetro existir.
  if (input.wabaDaSessao !== null) {
    return { coluna: "waba_id", valor: input.wabaDaSessao };
  }
  // Nenhum recorte possível — devolve o espelho da organização inteiro, que é
  // o que a rota fazia quando não havia canal oficial ativo.
  return null;
}
