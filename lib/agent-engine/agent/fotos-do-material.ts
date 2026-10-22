/**
 * FOTOS DO ACERVO — de "foto-1a2b3c4d" (o que o modelo pede) ao arquivo que sai.
 *
 * O modelo nunca vê o id do material nem o caminho no bucket: o `search_knowledge`
 * devolve só o APELIDO (`apelidoDaFoto`, em `lib/ai/rag/apelido-da-foto.ts`), e é
 * por ele que a `send_image` pede a foto. Aqui o apelido volta a ser um material,
 * e o material vira um envio — com três conferências que não confiam em ninguém:
 *
 *  1. A foto é DESTE agente: mesma organização, na lista de materiais da versão
 *     publicada, ativa e não arquivada. É o mesmo filtro do gate
 *     (`tem_fotos_no_acervo` em `agent-config.ts`) — se os dois divergissem, o
 *     modelo veria a ferramenta e toda chamada voltaria "desconhecida".
 *  2. O caminho é da pasta de materiais DESTA organização
 *     (`caminhoDeMaterialValido`). `source_metadata` é jsonb que um manager
 *     escreve pela REST, e quem assina a URL é a service role: um `blob_path`
 *     trocado faria o agente mandar ao cliente qualquer arquivo do bucket.
 *  3. O formato é de foto (`eMimeDeFoto`) — o mesmo que a rota de upload aceita.
 *
 * O LAÇO DE RETORNO: caminho ou formato adulterado não falha em silêncio. A fonte
 * recebe `last_index_error`, que o card do material já mostra — quem cuida do
 * acervo vê que AQUELA foto parou de sair, e por quê. O modelo recebe só
 * "indisponível": o motivo é do operador, não do cliente.
 */
import { apelidoDaFoto } from '@/lib/ai/rag/apelido-da-foto';
import { caminhoDeMaterialValido, eMimeDeFoto } from '@/lib/ai/rag/imagem';

import type { Queryable } from '../queue/queue';
import type { ImagemDoEnvio } from '../edge/crm/send-message';

export type FotoResolvida =
  | { ok: true; foto: ImagemDoEnvio }
  | { ok: false; code: 'foto_desconhecida' | 'foto_indisponivel'; message: string };

interface LinhaDaFoto {
  id: string;
  name: string | null;
  source_metadata: Record<string, unknown> | null;
}

/** O texto que o card do material mostra quando a foto não pôde sair. */
export const ERRO_DE_CAMINHO_DA_FOTO =
  'O arquivo desta foto não está na pasta de fotos da organização — o agente não pode enviá-la. Envie a foto de novo.';
export const ERRO_DE_FORMATO_DA_FOTO =
  'O formato registrado desta foto não é JPG, PNG ou WebP — o agente não pode enviá-la. Envie a foto de novo.';

export async function resolverFotoDoAgente(
  db: Queryable,
  args: { tenantId: string; knowledgeSourceIds: readonly string[]; foto: string },
): Promise<FotoResolvida> {
  const pedido = args.foto.trim();
  if (args.knowledgeSourceIds.length === 0) return desconhecida(pedido);

  // A org entra explícita: `knowledge_source_ids` é um array solto, sem FK, e o
  // pool do engine não passa pela RLS.
  const { rows } = await db.query<LinhaDaFoto>(
    `select id, name, source_metadata
       from ai_knowledge_sources
      where organization_id = $1
        and id = any($2::uuid[])
        and source_type = 'imagem'
        and is_active
        and status <> 'archived'`,
    [args.tenantId, [...args.knowledgeSourceIds]],
  );

  const casadas = rows.filter((r) => apelidoDaFoto(r.id) === pedido);
  if (casadas.length === 0) return desconhecida(pedido);
  if (casadas.length > 1) {
    // 32 bits entre as fotos de UM agente: quase impossível, mas escolher uma
    // seria mandar ao cliente uma foto que talvez não seja a que o trecho descrevia.
    return indisponivel();
  }

  const linha = casadas[0]!;
  const meta = linha.source_metadata ?? {};
  const path = meta.blob_path;
  const mime = typeof meta.mime_type === 'string' ? meta.mime_type : '';

  if (!caminhoDeMaterialValido(path, args.tenantId)) {
    await registrarErroNaFonte(db, args.tenantId, linha.id, ERRO_DE_CAMINHO_DA_FOTO);
    return indisponivel();
  }
  if (!eMimeDeFoto(mime)) {
    await registrarErroNaFonte(db, args.tenantId, linha.id, ERRO_DE_FORMATO_DA_FOTO);
    return indisponivel();
  }

  const nome =
    (linha.name ?? '').trim() ||
    (typeof meta.filename === 'string' ? meta.filename.trim() : '') ||
    pedido;
  return { ok: true, foto: { materialId: linha.id, path, mime, nome } };
}

function desconhecida(pedido: string): FotoResolvida {
  return {
    ok: false,
    code: 'foto_desconhecida',
    message:
      `não existe foto "${pedido}" entre os materiais deste agente. Use só o valor do campo "foto" ` +
      'que o search_knowledge devolveu — nunca invente. Sem foto encontrada, responda em texto.',
  };
}

function indisponivel(): FotoResolvida {
  return {
    ok: false,
    code: 'foto_indisponivel',
    message:
      'essa foto não pode ser enviada agora — não tente de novo; responda em texto com o que o material diz e siga a conversa.',
  };
}

/**
 * Grava o motivo na fonte. Nunca lança: o cliente já vai receber texto no lugar
 * da foto, e uma falha ao registrar não pode derrubar o turno que está
 * respondendo. O filtro de organização é o mesmo da leitura.
 */
async function registrarErroNaFonte(db: Queryable, tenantId: string, sourceId: string, erro: string): Promise<void> {
  try {
    await db.query(
      `update ai_knowledge_sources
          set last_index_error = $3
        where organization_id = $1 and id = $2`,
      [tenantId, sourceId, erro],
    );
  } catch {
    // Laço de retorno é enriquecimento; o envio já foi recusado do jeito certo.
  }
}
