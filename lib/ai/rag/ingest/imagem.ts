/**
 * O TRECHO DE UMA FOTO — o que o agente encontra quando procura no acervo.
 *
 * O modelo não vê a imagem ao buscar: ele vê texto. Então a foto vira UM trecho
 * só, com o nome e a descrição que a pessoa escreveu, e mais nada:
 *
 *   Foto: {nome}
 *   {descrição}
 *
 * Um trecho, e não `chunkText`: a descrição tem teto de
 * `DESCRICAO_DA_FOTO_MAX` caracteres justamente para caber inteira. Picada, a
 * metade de baixo de uma cartela de cores seria achada sem o nome da foto, e o
 * agente não saberia qual foto mandar.
 *
 * A metadata leva o APELIDO (`foto-xxxxxxxx`), nunca `blob_path` nem o id do
 * material: o retorno do `search_knowledge` chega ao modelo, e
 * `projetarRetornoDeTool` corta `*_id`/`*_path` — o apelido é o que sobrevive e
 * é por ele que o envio acha a foto (`apelido-da-foto.ts`). Gravar o caminho no
 * trecho seria pôr no contexto do modelo um endereço do bucket.
 *
 * Fica fora do `workers/rag-indexer.ts` para ser testável sem subir o worker
 * inteiro (Storage, embedding, loja). O worker só a chama.
 */

import { apelidoDaFoto } from "@/lib/ai/rag/apelido-da-foto";
import { ErroDeExtracao } from "@/lib/ai/rag/ingest/documento";

export interface FonteDeFoto {
  id: string;
  name: string;
  source_metadata: Record<string, unknown> | null;
}

export interface PedacoDeFoto {
  content: string;
  metadata: { source_type: "imagem"; foto: string };
}

export function pedacosDeImagem(fonte: FonteDeFoto): PedacoDeFoto[] {
  const bruta = fonte.source_metadata?.descricao;
  const descricao = typeof bruta === "string" ? bruta.trim() : "";
  if (!descricao) {
    // ErroDeExtracao, como documento ilegível: o motivo vai escrito no card do
    // material e na Central, em vez de a foto entrar muda e nunca ser achada.
    throw new ErroDeExtracao(
      "a foto está sem descrição — escreva o que ela mostra para o agente conseguir encontrá-la",
    );
  }

  return [
    {
      content: `Foto: ${fonte.name.trim()}\n${descricao}`,
      metadata: { source_type: "imagem", foto: apelidoDaFoto(fonte.id) },
    },
  ];
}
