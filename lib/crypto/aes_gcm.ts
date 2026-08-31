/**
 * AES-256-GCM helpers para `ai_provider_credentials`.
 *
 * Key source: `process.env.AI_CRED_AES_KEY` — 32 bytes, em base64 OU em hex.
 * Output do `encryptKey`: três `Buffer`s separados (ciphertext, IV de 12 bytes,
 * tag de 16 bytes) que são gravados como `bytea` na tabela. Pra uso via PostgREST
 * use o helper `bufToBytea()` que produz a literal `\x<hex>`.
 *
 * Plaintext NUNCA deve ser logado, persistido ou retornado em response — apenas
 * o `last4` é exposto via view `ai_provider_credentials_safe`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

let cachedKey: Buffer | null = null;

/**
 * Erro de CONFIGURAÇÃO da instalação, não do que o usuário digitou.
 *
 * Existe como tipo próprio porque quem chama precisa saber a diferença: uma
 * chave de provedor recusada é problema de quem cola; uma `AI_CRED_AES_KEY`
 * ilegível é problema de quem instalou, e a pessoa na tela não tem NADA a
 * fazer sobre isso a não ser ouvir "erro interno" para sempre.
 */
export class ChaveDeCifragemInvalida extends Error {
  readonly comoCorrigir: string;
  constructor(motivo: string, comoCorrigir: string) {
    super(`AI_CRED_AES_KEY inválida: ${motivo}`);
    this.name = "ChaveDeCifragemInvalida";
    this.comoCorrigir = comoCorrigir;
  }
}

/**
 * Interpreta a chave em BASE64 **ou** em HEX, exigindo 32 bytes nos dois casos.
 *
 * O hex não é conveniência: era uma instalação inteira sem cadastro de IA. Este
 * arquivo aceitava só base64, e uma chave gerada com `openssl rand -hex 32` —
 * que é o formato de todos os OUTROS segredos do produto, e o que os geradores
 * de env por aí produzem — atravessava `Buffer.from(raw, "base64")` sem erro
 * nenhum: todo caractere hex também é um caractere base64 válido. O resultado
 * eram 48 bytes silenciosos, `createCipheriv` recusava, e o cliente via "Erro
 * interno" ao salvar a chave da IA. Nada aparecia no log do app nem no do
 * Postgres, porque a falha acontece ANTES do INSERT.
 *
 * A ordem importa: `^[0-9a-fA-F]{64}$` é testado ANTES do base64 porque essa
 * string satisfaz os dois, e ler como base64 dá 48 bytes — comprimento que o
 * AES-256 recusa. Ou seja, nenhuma instalação que hoje FUNCIONA muda de chave:
 * o caso desviado é exatamente o que já estava quebrado.
 */
function interpretarChave(raw: string): Buffer {
  const limpo = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(limpo)) return Buffer.from(limpo, "hex");

  // base64url (`-` e `_`) aparece em chave copiada de gerador web; normalizar
  // custa uma linha e evita o mesmo diagnóstico de horas por outro caminho.
  const buf = Buffer.from(limpo.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new ChaveDeCifragemInvalida(
      `esperados 32 bytes, lidos ${buf.length}`,
      "Gere uma nova com `openssl rand -base64 32` (ou `openssl rand -hex 32`) e ponha em AI_CRED_AES_KEY.",
    );
  }
  return buf;
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.AI_CRED_AES_KEY;
  if (!raw) {
    throw new ChaveDeCifragemInvalida(
      "não configurada",
      "Defina AI_CRED_AES_KEY no .env (32 bytes: `openssl rand -base64 32`).",
    );
  }
  cachedKey = interpretarChave(raw);
  return cachedKey;
}

/**
 * A chave está utilizável? Para health check e telas de diagnóstico — responde
 * sem cifrar nada e sem jamais devolver a chave.
 */
export function chaveDeCifragemUtilizavel(): { ok: true } | { ok: false; erro: string; comoCorrigir: string } {
  try {
    getKey();
    return { ok: true };
  } catch (err) {
    if (err instanceof ChaveDeCifragemInvalida) {
      return { ok: false, erro: err.message, comoCorrigir: err.comoCorrigir };
    }
    return { ok: false, erro: "falha inesperada ao ler AI_CRED_AES_KEY", comoCorrigir: "Veja o log do app." };
  }
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  /** Últimos 4 chars do plaintext, mostrados na UI pra identificação. */
  last4: string;
}

export function encryptKey(plaintext: string): EncryptedSecret {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("plaintext inválido pra encryptKey()");
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LENGTH_BYTES) {
    throw new Error(`tag length inesperada: ${tag.length}`);
  }
  const last4 = plaintext.slice(-4);
  return { ciphertext, iv, tag, last4 };
}

export function decryptKey(input: {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}): string {
  const { ciphertext, iv, tag } = input;
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Converte um Buffer em literal hex aceito pelo PostgREST pra colunas `bytea`.
 */
export function bufToBytea(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

/**
 * Inverso de `bufToBytea`: aceita o que o PostgREST devolve em colunas bytea
 * (string `\xHEX` em modo padrão, ou Buffer/Uint8Array dependendo do driver).
 */
export function byteaToBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    return Buffer.from(hex, "hex");
  }
  throw new Error("byteaToBuffer: formato inesperado");
}
