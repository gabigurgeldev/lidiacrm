"use client";
import { useQueryClient } from "@tanstack/react-query";

import { avisarEfeitosNoKanban, type EfeitoNoKanban } from "@/components/tags/efeitos-no-kanban";
import { SeletorDeTags } from "@/components/tags/SeletorDeTags";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { useT } from "@/hooks/i18n/useT";
import { chaveDosKanbansDoContato } from "@/hooks/kanban/useKanbansDoContato";

interface Props {
  contactId: string;
  tags: string[];
}

/**
 * As tags do CONTATO, escolhidas do catálogo (migration 0248).
 *
 * Antes era um campo de texto livre: cada atendente digitava a sua grafia e o
 * filtro do inbox nunca casava. Agora se escolhe de uma lista com cor; criar
 * tag nova é na página Tags (manager+). Tag aplicada que está ligada a uma
 * coluna de Kanban leva o contato para lá — e a tela diz para onde.
 *
 * Grava a cada escolha. O seletor em si (`SeletorDeTags`) é o mesmo dos
 * diálogos de novo/editar contato, que gravam só no "Salvar".
 */
export function ContactTagsEditor({ contactId, tags }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const mutation = useUpdateContact(contactId);

  function aplicar(next: string[]) {
    mutation.mutate(
      { tags: next },
      {
        onSuccess: (r) => {
          const efeitos = (r.data as { kanban_efeitos?: EfeitoNoKanban[] }).kanban_efeitos;
          if (avisarEfeitosNoKanban(efeitos, t)) {
            void qc.invalidateQueries({ queryKey: chaveDosKanbansDoContato(contactId) });
          }
          // As tags do contato aparecem no CARD de todo Kanban onde ele está, e o
          // Realtime do quadro só escuta crm_leads — sem isto o card mostrava a
          // tag velha até alguém mexer no negócio.
          void qc.invalidateQueries({ queryKey: ["board"] });
        },
      },
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border p-2" data-testid="tags-do-contato">
      <SeletorDeTags
        valor={tags}
        aoMudar={aplicar}
        desabilitado={mutation.isPending}
        testIdDoBotao="adicionar-tag-ao-contato"
      />
    </div>
  );
}
