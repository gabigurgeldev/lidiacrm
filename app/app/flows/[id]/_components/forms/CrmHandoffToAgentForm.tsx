"use client";

import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { Aviso, Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `crm.handoff_to_agent` — com um aviso que precisa estar aqui.
 *
 * Este bloco desfaz a passagem para humano, inclusive a trava que o próprio
 * agente de IA não pode soltar sozinho (`contacts.force_human`, ver
 * `lib/escalacao/retomada.ts`). Quem monta o fluxo precisa saber disso ANTES de
 * publicar, e não depois de descobrir que uma conversa escalada voltou para a
 * IA sem ninguém pedir.
 *
 * Os campos servem ao fim de uma TRIAGEM: o que o fluxo coletou vai junto, e a
 * IA responde na hora.
 */
export function CrmHandoffToAgentForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  const chave = (campo: string, rotulo: string, dica: string) => (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id={`entrega-${campo}`}
          checked={config[campo] === true}
          onCheckedChange={(v) => mudar({ [campo]: v })}
        />
        <label htmlFor={`entrega-${campo}`} className="text-sm">
          {rotulo}
        </label>
      </div>
      <Dica texto={dica} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Aviso
        texto={t(
          "A conversa volta para o agente de IA atender. Se ela tinha sido passada para uma pessoa, esta passagem é DESFEITA — inclusive quando foi um atendente que assumiu. Use depois de ter certeza de que o humano terminou.",
        )}
      />
      <Secao>
        <Campo rotulo={t("O que a IA precisa saber (opcional)")}>
          <CampoComVariavel
            multilinha
            linhas={5}
            maxLength={4000}
            valor={String(config.contexto ?? "")}
            aoMudar={(v) => mudar({ contexto: v })}
            placeholder={"Nome: {{vars.nome}}\nSistema: {{vars.sistema}}\nProblema: {{vars.problema}}"}
            testid="campo-contexto-para-ia"
          />
          <Dica
            texto={t(
              "Vai para o resumo que o agente lê antes de responder — ele começa sabendo o que o cliente já contou.",
            )}
          />
        </Campo>
        {chave(
          "iniciar_atendimento",
          t("A IA responde na hora"),
          t("Sem isto, a IA só fala quando o cliente mandar a próxima mensagem."),
        )}
        {chave(
          "nao_tirar_de_pessoa",
          t("Não tirar a conversa de uma pessoa"),
          t("Se alguém da equipe assumiu, ou a conversa foi passada para a equipe durante o fluxo, segue por \"Uma pessoa já assumiu\"."),
        )}
      </Secao>
    </div>
  );
}
