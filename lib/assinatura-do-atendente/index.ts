/**
 * Assinatura do atendente — o nome que vai em cima da mensagem humana.
 *
 * ─── O formato, e por que ele é um só ──────────────────────────────────────
 *
 * `*Maria:*\nmensagem` — o negrito do WhatsApp na primeira linha, o texto
 * embaixo. É o MESMO texto que o cliente recebe e que fica gravado em
 * `messages.body`: o dedup de eco do Stevo casa por `body`
 * (`lib/channels/stevo/ingest.ts`), então gravar uma coisa e mandar outra
 * duplicaria a mensagem no histórico. Por isso a tela não guarda o nome à
 * parte — ela RELÊ o prefixo com `separarAssinatura` e desenha o nome em
 * negrito, sem os asteriscos.
 *
 * ─── Onde a preferência mora ───────────────────────────────────────────────
 *
 * `auth.users.user_metadata.assinatura`, ao lado de `locale` e `full_name`: é
 * preferência da PESSOA, como o idioma do topo. Este arquivo é o schema central
 * desse pedaço de jsonb — nenhum outro lugar lê o path direto.
 *
 * Roda no cliente (Composer, bolha) e no servidor (rota de envio): sem import
 * de servidor aqui.
 */
import { z } from "zod";

/** Limite do nome. Cabe numa linha do WhatsApp no celular sem quebrar. */
export const NOME_DA_ASSINATURA_MAX = 40;

export const nomeDaAssinaturaSchema = z
  .string()
  .trim()
  .min(1, "Informe o nome da assinatura.")
  .max(NOME_DA_ASSINATURA_MAX, `Use até ${NOME_DA_ASSINATURA_MAX} caracteres.`)
  // `*` fecharia o negrito no meio do nome; quebra de linha partiria o prefixo
  // em dois e a tela não o reconheceria mais como assinatura.
  .refine((nome) => !/[*\r\n]/.test(nome), "O nome não pode ter * nem quebra de linha.");

export const assinaturaSchema = z.object({
  ativa: z.boolean(),
  nome: nomeDaAssinaturaSchema,
});

export type AssinaturaDoAtendente = z.infer<typeof assinaturaSchema>;

/**
 * Lê a preferência de `user_metadata`. Nunca lança: dado ausente ou torto vale
 * como "sem assinatura" — quem chama é o `loadAuthUser`, e um throw ali derruba
 * toda tela autenticada por causa de uma preferência.
 */
export function lerAssinatura(metadata: unknown): AssinaturaDoAtendente | null {
  if (!metadata || typeof metadata !== "object") return null;
  const bruto = (metadata as Record<string, unknown>).assinatura;
  const r = assinaturaSchema.safeParse(bruto);
  return r.success ? r.data : null;
}

/** O nome com que a mensagem deve sair — `null` quando a assinatura está desligada. */
export function nomeParaAssinar(assinatura: AssinaturaDoAtendente | null | undefined): string | null {
  return assinatura?.ativa ? assinatura.nome : null;
}

export function assinar(corpo: string, nome: string): string {
  return `*${nome}:*\n${corpo}`;
}

const PREFIXO = new RegExp(`^\\*([^*\\r\\n]{1,${NOME_DA_ASSINATURA_MAX}}):\\*\\n`);

/**
 * Separa o prefixo de assinatura do corpo, para a tela desenhar o nome em
 * negrito. Sem prefixo reconhecível, devolve o corpo intacto e `nome: null`.
 */
export function separarAssinatura(body: string): { nome: string | null; corpo: string } {
  const m = PREFIXO.exec(body);
  if (!m) return { nome: null, corpo: body };
  const nome = (m[1] ?? "").trim();
  if (!nome) return { nome: null, corpo: body };
  return { nome, corpo: body.slice(m[0].length) };
}
