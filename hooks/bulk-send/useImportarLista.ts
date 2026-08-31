/**
 * useImportarLista — POST multipart do CSV para /api/v1/bulk-sends/importar-lista.
 *
 * `fetch` cru e não o `apiClient` pela MESMA razão de
 * `hooks/contacts/useImportContacts.ts`: o client serializa body como JSON e
 * não fala FormData — um `JSON.stringify(new FormData())` rende `{}` e a rota
 * receberia um corpo vazio, com o erro aparecendo como "envie o arquivo" para
 * quem acabou de enviar o arquivo.
 *
 * A diferença para o import de contatos é o que volta: aqui saem os IDs de
 * TODOS os contatos resolvidos (criados e já existentes) mais o recorte das
 * guardas. Numa campanha, o contato que já estava na base é justamente quem
 * mais deve receber.
 */
import { useMutation } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/types";
import type { ApiErrorBody } from "@/lib/api/types";
import { randomId } from "@/lib/random-id";

export interface RecorteDaPlanilha {
  contact_ids: string[];
  criados: number;
  ja_existiam: number;
  linhas_com_erro: Array<{ linha: number; motivo: string }>;
  vao_receber: number;
  fora_por_motivo: Record<string, number>;
  repetidos: number;
}

async function subir(file: File): Promise<RecorteDaPlanilha> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/v1/bulk-sends/importar-lista", {
    method: "POST",
    headers: { "Idempotency-Key": randomId() },
    body: form,
    credentials: "same-origin",
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (parsed as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "unknown_error",
      e?.details,
      e?.request_id ?? randomId(),
      e?.message,
    );
  }
  return (parsed as { data: RecorteDaPlanilha }).data;
}

export function useImportarLista() {
  return useMutation({ mutationFn: subir });
}
