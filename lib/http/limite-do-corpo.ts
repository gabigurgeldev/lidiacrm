/**
 * O teto de corpo de requisição que o `proxy.ts` do Next deixa passar
 * (`experimental.proxyClientMaxBodySize` em `next.config.ts`).
 *
 * Mora aqui, e não no `next.config.ts`, para o teste conseguir importá-lo sem
 * carregar o Sentry. É o MAIOR upload que alguma rota aceita (a mídia da
 * conversa, 50 MB) mais 1 MB para o envelope do multipart — a mesma folga do
 * guard de Content-Length de `app/api/v1/conversations/[id]/media/route.ts`.
 *
 * Abaixo disso o Next corta o corpo sem erro, a rota recebe multipart
 * truncado e responde "Campo 'file' (multipart) obrigatório". Quem garante que
 * nenhuma rota passa a aceitar mais do que este teto é
 * `tests/unit/limite-do-corpo-cobre-os-uploads.test.ts`.
 */
// Relativo, não `@/`: este arquivo é carregado pelo `next.config.ts`, que não
// passa pelo mapa de caminhos do tsconfig.
import { MAX_MEDIA_BYTES } from "../messaging/media/types";

export const LIMITE_DO_CORPO_DA_REQUISICAO = MAX_MEDIA_BYTES + 1_048_576;
