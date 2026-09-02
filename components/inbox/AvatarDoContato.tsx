"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * O rosto do contato — o mesmo em todo lugar do inbox.
 *
 * ═══ Por que um componente, e não três cópias ═══
 *
 * A foto aparecia SÓ na lista de conversas. O cabeçalho da conversa e o painel
 * de contato — as duas telas em que se olha para UMA pessoa — não mostravam
 * rosto nenhum. Cada um deles ia precisar da mesma regra de três partes: só
 * pedir a imagem quando existe arquivo, nunca pedir para contato anonimizado, e
 * cair no mesmo desenho quando não há foto. Três cópias divergiriam na segunda.
 *
 * ═══ SILHUETA, e não iniciais ═══
 *
 * A queda eram as iniciais num círculo colorido — vocabulário de CRM. O
 * WhatsApp usa a silhueta cinza, e a diferença não é só de gosto: iniciais
 * PARECEM informação sobre a pessoa (e num contato salvo como "5563984038147"
 * elas são "56"), enquanto a silhueta diz exatamente o que há para dizer —
 * "não temos a foto".
 *
 * ═══ Anonimizado nunca mostra rosto ═══
 *
 * A rota já recusa; a tela também não pede. Duas guardas para a mesma regra
 * porque a anonimização é declarada irreversível, e uma requisição que sai é
 * uma requisição que pode ser respondida por um cache antigo.
 */
export function AvatarDoContato({
  contactId,
  temFoto,
  anonimizado,
  nome,
  className,
  tamanhoDoIcone = 18,
}: {
  contactId: string | null | undefined;
  /** Existe arquivo no bucket? Vem de `contacts.avatar_storage_path`. */
  temFoto: boolean;
  anonimizado?: boolean | null;
  /** Só para o `alt` — o rosto é de alguém, e o leitor de tela precisa do nome. */
  nome?: string | null;
  className?: string;
  tamanhoDoIcone?: number;
}) {
  const mostrar = Boolean(contactId) && temFoto && !anonimizado;

  return (
    <Avatar className={cn("bg-surface-elevated", className)}>
      {/*
        Só monta a <img> quando existe arquivo: sem isso o browser pediria a rota
        para TODO contato da lista e levaria 404 em cada um sem foto — que é a
        maioria. O AvatarFallback do Radix já cobre o caso de a imagem não
        carregar, então a silhueta nunca some.
      */}
      {mostrar ? (
        <AvatarImage
          src={`/api/v1/contacts/${contactId}/avatar`}
          alt={nome ?? ""}
          className="object-cover"
        />
      ) : null}
      <AvatarFallback className="bg-transparent text-text-subtle">
        <User size={tamanhoDoIcone} weight="fill" aria-hidden />
      </AvatarFallback>
    </Avatar>
  );
}
