/**
 * Qual NOME esta conexão deve exibir, observado do perfil do WhatsApp.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 * `lib/schemas/channels.ts` documentava `display_name` como
 *
 *     um rótulo amigável ("Vendas", "Suporte") que o WAHA sobrescreve com o
 *     nome do perfil quando a sessão fica WORKING
 *
 * e essa sobrescrita NÃO EXISTIA em lugar nenhum do repositório. `me.pushName`
 * era lido em dois pontos (a rota de sync da conexão e a do onboarding) e
 * descartado nos dois. Some a isso que a tela de conectar faz `POST` com corpo
 * VAZIO (`components/connections/ConnectionsClient.tsx`), sem campo de nome:
 * logo `display_name` nascia `NULL` em 100% das conexões criadas pela tela.
 *
 * O preço aparece no aviso de conexão caída, que escolhe o apelido em
 * `health.ts` como `display_name ?? phone_number ?? "sem nome"`. Numa
 * instalação real, com dois números pareados e nomeados no celular, o dono leu:
 *
 *     WhatsApp sem nome está desconectado — nenhuma mensagem entra nem sai.
 *
 * "Sem nome" para uma conexão que TEM nome, e que ele não tinha como nomear —
 * um aviso que não responde a pergunta que ele existe para responder ("QUAL
 * conexão caiu?"), num momento em que a resposta é urgente.
 *
 * ─── Por que só quando WORKING ──────────────────────────────────────────────
 *
 * Mesma razão do irmão `numero-observado.ts`, e ela já foi paga uma vez ali: o
 * `me` do WAHA é o do ÚLTIMO pareamento que vingou, e segue sendo servido com a
 * sessão fora do ar — medido, duas sessões em FAILED devolvendo o MESMO `me`.
 * Fora de WORKING isso não é observação, é eco.
 *
 * ─── Por que NÃO sobrescrever um nome que já existe ─────────────────────────
 *
 * Aqui a regra é o INVERSO da do número, de propósito. O número é um fato do
 * aparelho: se mudou, o banco estava mentindo e tem de ser corrigido. O nome é
 * uma ESCOLHA de quem opera — "Vendas", "Suporte" — e o schema promete essa
 * escolha. Sobrescrever com o `pushName` a cada health check apagaria, a cada
 * cinco minutos, o rótulo que a pessoa acabou de digitar.
 *
 * Então este helper só preenche o VAZIO. Ele existe para que nenhuma conexão
 * nasça anônima, não para governar o nome depois disso.
 */

/** O estado em que o `me` do transporte descreve o aparelho de verdade. */
const STATUS_EM_QUE_O_NOME_VALE = "WORKING";

/** Teto de `createChannelSchema.display_name` — o nome tem de caber no que a API aceita. */
const LIMITE_DE_CARACTERES = 80;

export function nomeObservadoDaSessao(input: {
  /** `me.pushName` como o transporte devolve. */
  pushName: string | null | undefined;
  /** O JID (`5511999998888@c.us`), para recusar um pushName que é só o telefone. */
  jid?: string | null | undefined;
  /** Status lido AGORA, não o que estava no banco. */
  statusAoVivo: string | null | undefined;
  /** O que já está gravado — devolvido de volta sempre que houver. */
  gravado: string | null;
}): string | null {
  // Nome já escolhido (pelo dono ou por uma observação anterior) manda. Ver o
  // cabeçalho: este helper preenche o vazio, não governa o nome.
  if (input.gravado !== null && input.gravado.trim() !== "") return input.gravado;

  if (!input.pushName) return input.gravado;
  if ((input.statusAoVivo ?? "").toUpperCase() !== STATUS_EM_QUE_O_NOME_VALE) {
    return input.gravado;
  }

  // Colapsa espaço e quebra de linha: `pushName` é texto livre digitado no
  // celular, e um nome com `\n` no meio quebra o layout do aviso.
  const limpo = input.pushName.replace(/\s+/gu, " ").trim();
  if (!limpo) return input.gravado;

  // pushName que é o próprio telefone não acrescenta nada ao fallback que já
  // existe em health.ts (`display_name ?? phone_number`), e gravá-lo faria a
  // coluna de ESCOLHA carregar um fato — atrapalhando quem for renomear depois.
  const numero = (input.jid ?? "").replace(/@.*/u, "").replace(/\D/gu, "");
  if (numero && limpo.replace(/\D/gu, "") === numero) return input.gravado;

  return limpo.slice(0, LIMITE_DE_CARACTERES);
}
