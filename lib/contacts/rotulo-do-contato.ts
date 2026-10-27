/**
 * COMO SE CHAMA ESTA PESSOA NA TELA — uma decisão, um lugar.
 *
 * ═══ POR QUE CENTRALIZAR ═══
 *
 * A mesma cadeia `display_name || name || phone_number || <literal>` estava
 * copiada em **seis** arquivos, com **quatro** finais diferentes (`Sem nome`,
 * `Contato sem nome`, `—`, `—`) e duas variações de conteúdo: a ficha do contato
 * e a tabela de contatos **não usavam o telefone**, então quem tinha número mas
 * não tinha nome aparecia como "Sem nome" numa tela e com o número em outra.
 *
 * Seis cópias não divergem por descuido — divergem porque cada tela nova
 * reescreve a cadeia do jeito que parece certo naquele arquivo. A sétima ia
 * nascer com um quinto final.
 *
 * ═══ A REGRA QUE NENHUMA DELAS TINHA ═══
 *
 * **Identificador técnico não é nome de gente.** `Contato 543134@lid` esteve na
 * tela do atendente da produção; o produtor daquela string morreu, mas o dado
 * ficou, e o passo seguinte da spec 17 vai LER o nome do contato para escrever o
 * título do card no kanban — sem esta guarda, o resíduo vaza para o quadro.
 *
 * E o consumidor não é só humano: `lib/ai/render-system-prompt.ts` põe o nome do
 * contato no prompt do modelo. Um rótulo técnico ali é a mesma doença que a spec
 * 16 mediu em 30% dos turnos — vocabulário de máquina chegando ao cliente.
 */

import { phoneForDisplay } from "@/lib/channels/phone-variants";

/** O que qualquer tela precisa saber para chamar alguém pelo nome. */
export interface ContatoNomeavel {
  display_name?: string | null;
  name?: string | null;
  phone_number?: string | null;
}

/** Quando não há nada apresentável. Um literal, não quatro. */
export const SEM_NOME = "Sem nome";

/**
 * Cheira a identificador de máquina?
 *
 * Conservador de propósito: recusar um nome legítimo é pior que deixar passar um
 * técnico, porque o primeiro apaga a identidade de uma pessoa real. Por isso as
 * âncoras — `Contato 5431` sai, `Contato Comercial da Loja` fica.
 */
export function ehIdentificadorTecnico(valor: string): boolean {
  const v = valor.trim();
  if (v === "") return true;
  // Sufixos de endereçamento do WhatsApp em qualquer posição.
  if (/@(lid|c\.us|s\.whatsapp\.net|g\.us)\b/i.test(v)) return true;
  // O rótulo que o código antigo inventava: "Contato " + dígitos, e só isso.
  if (/^contato\s+\d+$/i.test(v)) return true;
  // Só dígitos e longo demais para ser apelido — é id, não nome. Telefone
  // formatado (com +, espaço ou hífen) NÃO cai aqui: ele é um rótulo útil e tem
  // caminho próprio abaixo.
  if (/^\d{9,}$/.test(v)) return true;
  return false;
}

/** Só dígitos, `+`, espaço e pontuação de telefone, com 8+ dígitos: é número, não nome. */
function pareceTelefone(v: string): boolean {
  return /^[+\d\s().-]+$/.test(v) && v.replace(/\D/g, "").length >= 8;
}

/**
 * O NOME da pessoa, ou `null` quando não se sabe — para quem tem fallback
 * próprio (um JSON de API, um prompt). Quem desenha na tela usa
 * `rotuloDoContato`, que completa com o telefone.
 *
 * ═══ `name` ANTES de `display_name` ═══
 *
 * Esta ordem já esteve invertida, e o cabeçalho antigo dizia que
 * `display_name` era "o que uma pessoa escolheu". Não é: quem grava
 * `display_name` é o ingest do WhatsApp (`fn_upsert_wa_contact`, com o
 * `pushName` do perfil — "Eucimar Silva✨🌸"), e ele só completa o vazio, nunca
 * sobrescreve. Quem grava `name` é gente: "Editar contato", novo contato,
 * importação, a proposta de dado aceita.
 *
 * Com a ordem invertida, o atendente corrigia o nome e a tela continuava com o
 * do perfil — medido em produção (2026-10-27): 1.680 de 5.551 contatos têm
 * `display_name`, e em todos eles editar o nome não mudava nada na tela.
 */
export function nomeDoContato(c: ContatoNomeavel | null | undefined): string | null {
  if (!c) return null;
  for (const bruto of [c.name, c.display_name]) {
    const v = (bruto ?? "").trim();
    if (v !== "" && !ehIdentificadorTecnico(v) && !pareceTelefone(v)) return v;
  }
  return null;
}

/**
 * O rótulo. Primeiro o nome que uma pessoa escreveu, depois o do perfil do
 * WhatsApp (`nomeDoContato`), depois o número — e só então a admissão de que
 * não se sabe o nome.
 *
 * Celular BR aparece COM o nono dígito: `+553284793302` e `+5532984793302` são
 * a mesma pessoa, e o 9 é o que o atendente espera copiar.
 */
export function rotuloDoContato(
  c: ContatoNomeavel | null | undefined,
  t: (texto: string) => string = (texto) => texto,
): string {
  if (!c) return t(SEM_NOME);

  const nome = nomeDoContato(c);
  if (nome) return nome;

  const tel = (c.phone_number ?? "").trim();
  if (tel !== "") return phoneForDisplay(tel);

  // Sem telefone cadastrado, um número digitado no lugar do nome ainda diz mais
  // que "Sem nome".
  for (const bruto of [c.name, c.display_name]) {
    const v = (bruto ?? "").trim();
    if (v !== "" && pareceTelefone(v)) return v;
  }

  return t(SEM_NOME);
}
