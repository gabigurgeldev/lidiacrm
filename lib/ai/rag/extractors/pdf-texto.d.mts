export type DesfechoDoPdf =
  | { ok: true; texto: string }
  | { ok: false; tipo: "sem_texto" | "canvas" | "falha"; mensagem: string };

export function extrairTextoDoPdf(bytes: Uint8Array): Promise<DesfechoDoPdf>;
