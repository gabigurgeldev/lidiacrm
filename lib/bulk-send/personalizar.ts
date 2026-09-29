/**
 * `{{nome}}` e `{{primeiro_nome}}` POR DESTINATÁRIO no disparo em massa.
 *
 * Antes disto o disparo mandava o MESMO texto e os MESMOS valores de modelo a
 * todo mundo (`enviar.ts`), e "Oi, {{primeiro_nome}}" não existia — a mensagem
 * de aniversário (`lib/aniversario`) é o primeiro uso, e os disparos manuais
 * ganham junto.
 *
 * ── Contato sem nome ─────────────────────────────────────────────────────────
 *
 * `interpolateTemplate` (inbox) mantém o literal quando falta o valor: certo
 * para o atendente, que vê o texto ANTES de mandar. Aqui não há ninguém olhando
 * — o literal chegaria ao cliente como "Oi, {{primeiro_nome}}!". Então:
 *   - no TEXTO, a variável some e a pontuação órfã é arrumada ("Oi, !" → "Oi!");
 *   - no VALOR de modelo oficial, vira "cliente" — a Meta recusa parâmetro vazio.
 * Variável desconhecida continua literal, como sempre: nada muda para quem não
 * usa as duas.
 */
const VARIAVEL = /\{\{\s*(nome|primeiro_nome)\s*\}\}/gi;

export function temVariavelDeNome(texto: string | null | undefined): boolean {
  return typeof texto === "string" && /\{\{\s*(nome|primeiro_nome)\s*\}\}/i.test(texto);
}

function partes(nome: string | null | undefined) {
  const cheio = (nome ?? "").trim().replace(/\s+/g, " ");
  return { cheio, primeiro: cheio.split(" ")[0] ?? "" };
}

function trocar(texto: string, nome: string | null | undefined, vazio: string): string {
  const { cheio, primeiro } = partes(nome);
  return texto.replace(VARIAVEL, (_l, chave: string) => {
    const valor = chave.toLowerCase() === "nome" ? cheio : primeiro;
    return valor !== "" ? valor : vazio;
  });
}

export function personalizarTexto(texto: string, nome: string | null | undefined): string {
  const { cheio } = partes(nome);
  const saida = trocar(texto, nome, "");
  if (cheio !== "") return saida;
  // Só arruma quando uma variável sumiu — texto sem variável sai intacto.
  return saida
    .replace(/[ \t]+([,!.?])/g, "$1")
    .replace(/,([!.?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

export function personalizarValores(
  valores: Record<string, string> | null | undefined,
  nome: string | null | undefined,
): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(valores ?? {})) saida[k] = trocar(v, nome, "cliente");
  return saida;
}
