/**
 * As guardas COMPARTILHADAS por toda ação que manda mensagem para um contato:
 * existe, não está bloqueado, não foi anonimizado nem mesclado, tem telefone,
 * não recusou.
 *
 * Duas portas para a mesma régua: `checarContato(contato)` é o núcleo puro, e
 * `checarGuardasDeContato(ctx)` é a porta da automação, que só extrai o contato
 * do `ActionCtx` e delega. O disparo em massa usa o núcleo — ele monta a lista
 * de uma query própria e não tem `ActionCtx` para forjar.
 *
 * Nasceu porque a mesma sequência de 3 `if`s vivia em `send-whatsapp.ts` e em
 * `send-ai-message.ts` — irmãs de propósito (mesmo comentário de cabeçalho:
 * "MESMAS guardas... reescrevê-las aqui faria a ação nova nascer sem o
 * conserto que a antiga acabou de receber"). O gate de consentimento nasceu
 * SÓ na primeira (achado 2026-08-25) e ficaria esquecido na segunda até
 * alguém notar — exatamente o "conserto por instância" que este repo já
 * pagou (ver `desfecho-do-envio.ts`, mesmo raciocínio para o desfecho do
 * envio). Um módulo só, as duas ações chamam.
 *
 * ═══ Por que a recusa é um gate FIXO, não uma `condition` declarável ═══
 *
 * Porque não pode ter exceção por regra mal configurada. O motor de
 * `conditions` (`lib/automation/conditions.ts`) trata campo ausente +
 * operador `neq` como sempre-verdadeiro, o que deixaria passar exatamente o
 * caso mais perigoso se alguém configurasse a condição errada. Invariante de
 * conformidade fica em código, não em configuração que um admin desliga sem
 * querer.
 *
 * ═══ Por que ele lê `declined_at`, e NÃO a ausência de `granted_at` ═══
 *
 * Esta é a parte contra-intuitiva, e ela é medida, não opinada. O DEFAULT da
 * coluna `contacts.consent` (ver `supabase/baseline.sql`) já é
 *
 *     {"marketing": {"granted_at": null, "source": null, "version": null}, …}
 *
 * — ou seja, TODO contato do produto nasce com a mesma forma que uma recusa
 * deixaria. Bloquear por `granted_at` ausente bloqueia dois estados de uma vez:
 * "a pessoa disse não" e "**ninguém nunca perguntou**".
 *
 * E o segundo é a instalação inteira. Medido na `main` de 2026-08-26: o único
 * escritor de `consent.marketing.granted_at` em código de produção é o mapeador
 * do Respondi (`buildContactConsentGrant`, um call site), e não existe **nenhum**
 * controle de consentimento em `components/` ou `app/app/`. Um gate por ausência
 * faria toda automação de WhatsApp parar de enviar para lead de webhook
 * genérico, de importação, de criação manual e de inbound — sem tela para
 * consertar, e sem migração. Num produto self-host, isso é o cliente concluindo
 * que o produto quebrou.
 *
 * `declined_at` é a chave que só existe quando alguém respondeu NÃO
 * (`buildContactConsentDenial`, escrita pela ingestão). É sobre ela que a
 * guarda decide, e é o que torna verdadeira a promessa que a própria rota de
 * webhook já escrevia na `main`: a recusa registrada "pra quem olha o dossiê
 * saber POR QUE nenhuma automação de 1º toque disparou pra este lead".
 *
 * Coerente, além disso, com o gate de LGPD que este repositório já tem
 * (`lib/agent-engine/guardrails/lgpd/legal-basis.ts`): lá está escrito que
 * responder a quem te procurou NÃO é prospecção e não exige base legal de
 * prospecção — "do contrário todo 1º reply de inbound seria vetado". Quem
 * preencheu o seu formulário te procurou. Quem disse "não me mande mensagem",
 * não.
 */
import type { ActionCtx } from "@/lib/automation/types";

export type MotivoDeBloqueio =
  | "no_contact"
  | "contact_blocked"
  | "no_phone"
  | "consent_declined"
  | "contact_anonymized"
  | "contact_merged";

export interface ContatoLiberadoParaEnvio {
  id: string;
  phone_number: string;
}

export interface ContatoDoContexto {
  id: string;
  is_blocked?: boolean;
  phone_number?: string | null;
  consent?: { marketing?: { granted_at?: string | null; declined_at?: string | null } | null } | null;
  /**
   * LGPD: o titular pediu para apagar. Mandar mensagem para dado anonimizado é o
   * pior desfecho possível de qualquer caminho de envio.
   *
   * ⚠️ Campo OPCIONAL, e isso importa para não se prometer demais: quem não o
   * carregar no objeto não ganha a guarda — ela não vai ao banco buscar. A
   * automação passa o contato que veio no `context` do evento; se ele não trouxe
   * `is_anonymized`, o comportamento dela segue idêntico ao de antes (nem
   * conserto, nem regressão). Quem seleciona a coluna explicitamente é o disparo
   * em massa (`lib/bulk-send/montagem.ts`), que monta a lista a partir de uma
   * query própria.
   */
  is_anonymized?: boolean | null;
  /** Contato mesclado é lápide: quem responde é o sobrevivente, não ele. */
  is_merged_into?: string | null;
}

export type ResultadoDaGuarda =
  | { ok: true; contact: ContatoLiberadoParaEnvio }
  | { ok: false; reason: MotivoDeBloqueio };

/**
 * O NÚCLEO PURO: um contato entra, um veredito sai. Sem `ActionCtx`, sem banco.
 *
 * Existe separado porque o disparo em massa precisa da MESMA régua e não tem um
 * `ActionCtx` para forjar — ele monta a lista a partir de uma query própria. A
 * alternativa era o disparo reescrever as guardas, e é exatamente o "conserto
 * por instância" que o cabeçalho deste arquivo conta ter pago uma vez: o gate de
 * consentimento nasceu só numa das duas ações irmãs e ficou esquecido na outra.
 *
 * Corre as guardas na ordem em que mais barato falha primeiro (nenhum dado lido
 * antes de saber que há contato). Devolve o contato tipado e estreito — só o que
 * o chamador precisa — quando passa; a razão do bloqueio quando não.
 */
export function checarContato(contact: ContatoDoContexto | null | undefined): ResultadoDaGuarda {
  if (!contact) return { ok: false, reason: "no_contact" };
  if (contact.is_blocked) return { ok: false, reason: "contact_blocked" };
  // LGPD e lápide vêm ANTES do telefone: os dois são "esta pessoa não recebe
  // mais mensagem", e é essa a frase que a tela precisa mostrar. Se o telefone
  // falhasse primeiro, um contato anonimizado (que perde o telefone junto)
  // apareceria como "sem telefone" — e o operador tentaria consertar o que não
  // é para ser consertado.
  if (contact.is_anonymized) return { ok: false, reason: "contact_anonymized" };
  if (contact.is_merged_into) return { ok: false, reason: "contact_merged" };
  if (!contact.phone_number) return { ok: false, reason: "no_phone" };
  // Recusa registrada — não "grant ausente". Ver o cabeçalho.
  if (contact.consent?.marketing?.declined_at) return { ok: false, reason: "consent_declined" };
  return { ok: true, contact: { id: contact.id, phone_number: contact.phone_number } };
}

/**
 * A porta da automação: pega o contato do `context` do evento e delega ao núcleo.
 * Uma linha, de propósito — a régua mora num lugar só.
 */
export function checarGuardasDeContato(ctx: ActionCtx): ResultadoDaGuarda {
  return checarContato(ctx.context.contact as ContatoDoContexto | undefined);
}
