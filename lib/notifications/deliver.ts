import { toast } from "sonner";

import { emitNotification } from "./emit";
import { NOTIFY_KINDS, type NotifyKind } from "./kinds";
import { canalLigado, type NotifyCategory } from "./prefs";
import { tocarAviso } from "./som";

export interface EntregarAvisoInput {
  category: NotifyCategory;
  kind: NotifyKind;
  title: string;
  body: string;
  tag?: string;
  href?: string;
  icon?: string;
  /** Id do evento que as abas disputam para tocar (ver `som.ts`). Sem ele, `tag`. */
  chaveDoSom?: string;
  /** Assunto do bip: o mesmo grupo não toca de novo dentro de `janelaDoSomMs`. */
  grupoDoSom?: string;
  janelaDoSomMs?: number;
}

/**
 * Um aviso chega por três vias independentes:
 *
 *  - **som**: `tocarAviso`, controlado SÓ pela preferência da pessoa
 *    (Configurações › Notificações › "Tocar som"). Não depende de Push nem da
 *    permissão do navegador: era isso que deixava quem só tinha "No sistema"
 *    sem som nenhum;
 *  - **No sistema**: o toast;
 *  - **Push**: a notificação do navegador, sempre MUDA (`silenciar`). O som já
 *    veio da primeira via, ou a pessoa pediu silêncio.
 */
export function entregarAviso(input: EntregarAvisoInput): void {
  const chave = input.chaveDoSom ?? input.tag;
  if (chave) {
    void tocarAviso({
      som: NOTIFY_KINDS[input.kind].sound,
      chave: `${input.kind}:${chave}`,
      grupo: input.grupoDoSom,
      janelaMs: input.janelaDoSomMs,
    });
  }
  if (canalLigado(input.category, "in_app")) {
    toast(input.title, { description: input.body });
  }
  if (canalLigado(input.category, "push")) {
    emitNotification({
      kind: input.kind,
      title: input.title,
      body: input.body,
      tag: input.tag,
      href: input.href,
      icon: input.icon,
      force: true,
      silenciar: true,
    });
  }
}
