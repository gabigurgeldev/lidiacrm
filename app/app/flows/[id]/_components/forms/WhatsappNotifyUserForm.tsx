"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `whatsapp.notify_user` — avisa a EQUIPE, nunca o cliente.
 *
 * ## Duas mudanças que se encontraram aqui
 *
 * O destinatário por número fixo veio de outra frente (o bloco tinha um
 * destinatário só, o dono atual do lead, e quem quisesse avisar o gerente ou o
 * plantão não tinha caminho). O arquivo-por-bloco veio desta. As duas tocaram o
 * mesmo painel, e o conflito foi resolvido mantendo a estrutura nova e trazendo
 * a funcionalidade inteira para cá — que é o ponto do arquivo-por-bloco: a
 * próxima mudança neste bloco mexe só neste arquivo.
 *
 * ## Por que o telefone não tem máscara nem regex aqui
 *
 * Porque o valor pode ser um template (`{{vars.plantao}}`), e o `+` literal só
 * existe depois do `ctx.render`. Quem valida é `telefoneEmE164`, no `execute` —
 * e número fora do formato sai pela saída "Sem telefone cadastrado", que já
 * existe. Validar na tela recusaria a variável que é o caso mais útil.
 */
export function WhatsappNotifyUserForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  const destinatario = (config.destinatario ?? { tipo: "dono_do_lead" }) as {
    tipo?: string;
    telefone?: string;
  };
  const paraNumeroFixo = destinatario.tipo === "telefone";

  return (
    <Secao>
      <Campo rotulo={t("Para quem")}>
        <Select
          value={paraNumeroFixo ? "telefone" : "dono_do_lead"}
          onValueChange={(v) =>
            mudar({
              destinatario:
                v === "telefone"
                  ? { tipo: "telefone", telefone: destinatario.telefone ?? "" }
                  : { tipo: "dono_do_lead" },
            })
          }
        >
          <SelectTrigger data-testid="campo-destinatario-do-aviso">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dono_do_lead">{t("Quem está com o lead")}</SelectItem>
            <SelectItem value="telefone">{t("Um número fixo")}</SelectItem>
          </SelectContent>
        </Select>
      </Campo>

      {paraNumeroFixo ? (
        <Campo rotulo={t("Número que recebe o aviso")}>
          <Input
            value={String(destinatario.telefone ?? "")}
            maxLength={64}
            placeholder="+55 11 99999-8888"
            onChange={(e) => mudar({ destinatario: { tipo: "telefone", telefone: e.target.value } })}
            data-testid="campo-telefone-do-aviso"
          />
          <Dica
            texto={t(
              "Com DDI. Pode usar {{contact.phone_number}} ou uma variável do fluxo. Número fora do formato segue pela saída 'Sem telefone cadastrado'.",
            )}
          />
        </Campo>
      ) : (
        <Campo rotulo={t("De onde vem o telefone")}>
          <Dica
            texto={t(
              "O telefone de aviso de cada pessoa fica em Equipe › Atendimento, no botão Editar horário. Sem ele, o fluxo segue pela saída 'Sem telefone cadastrado'.",
            )}
          />
        </Campo>
      )}

      <Campo rotulo={t("Mensagem para o vendedor")}>
        <Textarea
          rows={6}
          maxLength={4000}
          value={String(config.mensagem ?? "")}
          onChange={(e) => mudar({ mensagem: e.target.value })}
          data-testid="campo-mensagem-do-aviso"
        />
        <Dica
          texto={t(
            "Use {{lead.title}}, {{lead.score}} e {{contact.phone_number}} para incluir os dados.",
          )}
        />
      </Campo>
    </Secao>
  );
}
