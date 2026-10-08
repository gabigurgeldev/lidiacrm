"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";

import { SeletorDeCanal } from "./SeletorDeCanal";
import { Aviso, Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `trigger.message_received` — toda mensagem de cliente serve, e agora dá para
 * dizer POR QUAIS NÚMEROS.
 *
 * O seletor existe aqui e no gatilho por palavra, nunca em um só: numa conta
 * com vários números conectados, o gatilho sem o campo dispara para todos sem
 * dizer, e quem configurou o outro acharia que os dois se comportam igual.
 *
 * Os campos de TRIAGEM (migration 0228) transformam o gatilho no começo de um
 * pré-atendimento: só na conversa nova, um por cliente, com a IA calada.
 */
export function TriggerMessageReceivedForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const quando = (config.quando as string | undefined) ?? "toda_mensagem";

  const chave = (campo: string, rotulo: string, dica: string) => (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id={`gatilho-${campo}`}
          checked={config[campo] === true}
          onCheckedChange={(v) => mudar({ [campo]: v })}
        />
        <label htmlFor={`gatilho-${campo}`} className="text-sm">
          {rotulo}
        </label>
      </div>
      <Dica texto={dica} />
    </div>
  );

  return (
    <Secao>
      <Aviso
        texto={t(
          "Este fluxo começa sozinho toda vez que um cliente manda mensagem. Para reagir só a certas palavras, use o bloco de palavra-chave.",
        )}
      />

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por quais números o fluxo escuta")}
        </p>
        <SeletorDeCanal
          proposito="escuta"
          valor={(config.canal_id as string | null) ?? null}
          aoEscolher={(id) => mudar({ canal_id: id })}
        />
      </div>

      <Campo rotulo={t("Quando começar")}>
        <Select value={quando} onValueChange={(v) => mudar({ quando: v })}>
          <SelectTrigger data-testid="campo-gatilho-quando">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="toda_mensagem">{t("Em toda mensagem")}</SelectItem>
            <SelectItem value="conversa_nova_ou_retorno">
              {t("Só no começo da conversa (primeira mensagem, ou volta depois de um tempo)")}
            </SelectItem>
            <SelectItem value="cliente_esperando_equipe">
              {t("Só quando o cliente está esperando a equipe (já foi passado para uma pessoa)")}
            </SelectItem>
          </SelectContent>
        </Select>
      </Campo>

      {quando === "cliente_esperando_equipe" ? (
        <Campo rotulo={t("Avisar no máximo a cada quantos minutos, por cliente")}>
          <Input
            type="number"
            min={1}
            max={1440}
            value={(config.intervalo_de_aviso_min as number | undefined) ?? 30}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) mudar({ intervalo_de_aviso_min: Math.min(1440, Math.max(1, n)) });
            }}
            data-testid="campo-gatilho-intervalo"
          />
          <Dica
            texto={t(
              "Use com o bloco \"Avisar o vendedor no WhatsApp\": quem foi passado para a equipe e escreve de novo não fica falando sozinho. Um cliente que manda várias mensagens seguidas gera um aviso só.",
            )}
          />
        </Campo>
      ) : null}

      {quando === "conversa_nova_ou_retorno" ? (
        <Campo rotulo={t("Horas sem conversa para contar como volta")}>
          <Input
            type="number"
            min={1}
            max={720}
            value={(config.horas_de_silencio as number | undefined) ?? 24}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) mudar({ horas_de_silencio: Math.min(720, Math.max(1, n)) });
            }}
            data-testid="campo-gatilho-horas"
          />
        </Campo>
      ) : null}

      {chave(
        "uma_por_contato",
        t("Uma vez por cliente de cada vez"),
        t("Enquanto o fluxo estiver em andamento para um cliente, as mensagens dele não começam outro."),
      )}
      {chave(
        "silenciar_ia",
        t("A IA fica calada enquanto o fluxo conversa"),
        t("O agente de IA não responde por cima das perguntas do fluxo. Para ele assumir no fim, use o bloco \"Entregar a conversa para a IA\"."),
      )}
      {chave(
        "pular_se_pessoa_atende",
        t("Não começar se uma pessoa da equipe está com a conversa"),
        t("Quem já está sendo atendido por alguém não recebe o fluxo de novo."),
      )}
    </Secao>
  );
}
