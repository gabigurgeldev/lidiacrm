/**
 * `channel_sessions.archived_at` — e o que fazer quando a coluna ainda não existe.
 *
 * Arquivar é como um canal "sai" do sistema sem levar o histórico junto
 * (migration 0106). A partir daí, TODO caminho que resolve uma sessão precisa
 * ignorar as arquivadas: a linha continua lá como âncora das FKs, mas para o
 * produto ela foi excluída — o número já foi deslogado no transporte e a
 * credencial do canal oficial já foi revogada.
 *
 * O caminho de VOLTA (reconectar o mesmo canal) é um só e mora em
 * `./reactivate`: quem ressuscita a linha grava a coluna por lá, para o estado
 * final ser "ativo" e não "ativo pela metade".
 *
 * ─── Por que existe um fallback, e por que ele não é paliativo ───────────────
 * Neste projeto o código chega ao clone/produção por deploy, e aplicar a
 * migration é passo SEPARADO e manual — já aconteceu de a `main` subir sem ela
 * (memória `project_vercel_deploy_sem_gate_de_schema`). Nesse estado, uma
 * consulta que filtra `archived_at` volta com SQLSTATE 42703 do Postgres,
 * repassado pelo PostgREST. Quem trata isso como "não achei" mostra "nenhum
 * número conectado" numa org que tem canal ligado, ou descarta a mensagem que
 * acabou de entrar.
 *
 * Repetir a consulta SEM o filtro não é degradar: se a coluna não existe, NADA
 * está arquivado, então o resultado sem filtro é o resultado exato. O que o
 * `schemaOutdated` acrescenta é o aviso — o chamador pode dizer ao operador que
 * falta rodar a migration em vez de o sistema mentir em silêncio.
 */

/** Coluna que separa canal vivo de canal excluído pelo usuário. */
export const ARCHIVED_AT = "archived_at";

/**
 * "Coluna não existe" chega em `error.code` de DUAS formas, pela mesma causa:
 *
 *  - `42703` é o SQLSTATE do **Postgres**, e é o que volta quando a coluna
 *    aparece num FILTRO ou num `select`: o PostgREST repassa o nome ao SQL que
 *    gera e quem recusa é o banco (por isso a mensagem sai com o alias interno
 *    dele — `column channel_sessions_1.archived_at does not exist`).
 *  - `PGRST204` é do **PostgREST**, que resolve as colunas do CORPO de uma
 *    escrita contra o schema cache antes de montar o UPDATE. O caminho de
 *    desarquivamento (`./reactivate`) grava `archived_at`, então é por aqui que
 *    ele passa num banco sem a migration.
 *
 * As duas levam ao MESMO desfecho — repetir sem a coluna —, então aceitar as
 * duas não afrouxa nada: o que mantém a detecção estreita é a mensagem NOMEAR a
 * coluna, não o código.
 */
const COLUNA_AUSENTE = new Set(["42703", "PGRST204"]);

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * O erro é "esta coluna não existe neste banco" — e não um erro de verdade.
 *
 * Genérica desde que o seletor do inbox passou a pedir `provider` para dizer se
 * o número é por QR code ou oficial: um clone que subiu o código sem aquela
 * migration receberia 42703 no `select` e a lista de números viria VAZIA, que a
 * tela lê como "nenhum número conectado" — o convite a parear de novo um número
 * que já está no ar, exatamente o defeito que esta tolerância existe para
 * impedir.
 *
 * O que mantém a detecção estreita continua sendo a mensagem NOMEAR a coluna,
 * não o código de erro.
 */
export function colunaAusenteNoErro(
  error: DbErrorLike | null | undefined,
  coluna: string,
): boolean {
  if (!error) return false;
  return COLUNA_AUSENTE.has(error.code ?? "") && (error.message ?? "").includes(coluna);
}

/** O caso que nomeou a função original. Hoje é um apelido do genérico acima. */
export function isArchivedColumnMissing(error: DbErrorLike | null | undefined): boolean {
  return colunaAusenteNoErro(error, ARCHIVED_AT);
}

/**
 * Roda a consulta que depende de `archived_at` e, só se o banco não tiver a
 * coluna, roda a alternativa sem ela.
 *
 * Duas closures em vez de um builder mutável porque o cliente do PostgREST é
 * thenable: reaproveitar o mesmo objeto na segunda tentativa reenviaria a
 * requisição já resolvida.
 */
export async function queryTolerantToMissingArchived<R extends { error: DbErrorLike | null }>(
  withArchived: () => PromiseLike<R>,
  withoutArchived: () => PromiseLike<R>,
): Promise<R & { schemaOutdated: boolean }> {
  return consultaTolerante(ARCHIVED_AT, withArchived, withoutArchived);
}

/**
 * A mesma dança para QUALQUER coluna que um clone antigo possa não ter.
 *
 * As duas closures e não um builder reaproveitado pela mesma razão de sempre: o
 * cliente do PostgREST é thenable, e reusar o objeto na segunda tentativa
 * reenviaria a requisição já resolvida.
 *
 * `schemaOutdated` é a soma OU: aninhar duas tolerâncias (é o que o seletor de
 * números faz — `provider` por fora, `archived_at` por dentro) precisa que a
 * bandeira sobreviva à camada de fora, senão a tela deixa de avisar que o banco
 * está atrás.
 */
export async function consultaTolerante<R extends { error: DbErrorLike | null }>(
  coluna: string,
  comAColuna: () => PromiseLike<R & { schemaOutdated?: boolean }>,
  semAColuna: () => PromiseLike<R & { schemaOutdated?: boolean }>,
): Promise<R & { schemaOutdated: boolean }> {
  const primeira = await comAColuna();
  if (!colunaAusenteNoErro(primeira.error, coluna)) {
    return { ...primeira, schemaOutdated: primeira.schemaOutdated === true };
  }
  const alternativa = await semAColuna();
  return { ...alternativa, schemaOutdated: true };
}
