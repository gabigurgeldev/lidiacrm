"use client";

import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** `whatsapp.notify_user` — avisa o VENDEDOR, nunca o lead. */
export function WhatsappNotifyUserForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();

  return (
    <Secao>
      <Campo rotulo={t("Mensagem para o vendedor")}>
        <Textarea
          rows={6}
          maxLength={4000}
          value={String(config.mensagem ?? "")}
          onChange={(e) =>
            aoMudarConfig({
              ...config,
              mensagem: e.target.value,
              destinatario: { tipo: "dono_do_lead" },
            })
          }
          data-testid="campo-mensagem-do-aviso"
        />
        <Dica
          texto={t(
            "Vai para o WhatsApp de quem está com o lead. Use {{lead.title}}, {{lead.score}} e {{contact.phone_number}} para incluir os dados.",
          )}
        />
        <Dica
          texto={t(
            "O telefone de aviso de cada pessoa fica em Ajustes. Sem ele, o fluxo segue pela saída 'Sem telefone cadastrado'.",
          )}
        />
      </Campo>
    </Secao>
  );
}
