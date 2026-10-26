/**
 * A tag como as rotas de `/api/v1/tags` a devolvem. Sem import nenhum: é lido
 * pela página de Tags, pelo seletor do inbox e pelo Kanban, todos `"use client"`.
 */

export interface ColunaDaTag {
  pipeline_id: string;
  pipeline_name: string;
  stage_id: string;
  stage_name: string;
}

export interface TagDoCatalogo {
  id: string;
  name: string;
  color: string;
  description: string | null;
  is_archived: boolean;
  created_at: string;
  /** Quantos contatos têm a tag. Só quando pedido (`?uso=1`). */
  uso?: number;
  colunas: ColunaDaTag[];
}
