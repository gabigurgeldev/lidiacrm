"use client";
import { Campo, Dica, Grupo, LinhaInterruptor } from "@/components/ajustes";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import {
  ROTULO_DA_VOZ,
  VOZES_DO_AGENTE,
  VOZES_POR_SERVICO,
  type ServicoDeVoz,
  type VozDoAgente,
} from "@/lib/ai/voz/vozes";

import type { PropsDaSecao } from "./estado";
import { ErroDoCampo } from "./pecas";

/** Como a resposta sai: em bolhas curtas, em áudio, com qual voz. */
export function SecaoEstilo({
  form,
  patch,
  disabled,
  erros,
  servicoDeVoz,
}: PropsDaSecao & { servicoDeVoz: ServicoDeVoz | null }) {
  const t = useT();
  return (
    <Grupo titulo={t("Estilo de resposta")}>
      <LinhaInterruptor
        id="split_messages"
        titulo={t("Várias mensagens curtas")}
        descricao={t(
          "Em vez de um bloco único, a resposta sai em bolhas separadas, espaçadas pelo mesmo ritmo anti-banimento do envio. O agente também é instruído a escrever em parágrafos curtos.",
        )}
        ligado={form.split_messages}
        aoMudar={(v) => patch({ split_messages: v })}
        desabilitado={disabled}
      />
      {form.split_messages ? (
        <Campo rotulo={t("Tamanho máximo por bolha (80–4000)")} htmlFor="split_max_chars">
          <Input
            id="split_max_chars"
            type="number"
            min={80}
            max={4000}
            step={20}
            value={form.split_max_chars}
            onChange={(e) => patch({ split_max_chars: Number(e.target.value) })}
            disabled={disabled}
            aria-invalid={!!erros.split_max_chars}
          />
          <ErroDoCampo texto={erros.split_max_chars} />
        </Campo>
      ) : null}

      {/* Responder em áudio (migration 0222) */}
      <LinhaInterruptor
        id="reply_as_audio"
        titulo={t("Responder em áudio (nota de voz)")}
        descricao={
          servicoDeVoz
            ? t(
                "Cada resposta do agente sai como áudio, com a voz escolhida abaixo. Mensagens com link ou muito longas continuam em texto. Se o serviço de voz falhar, o cliente recebe a resposta em texto e a Central de avisos mostra o motivo.",
              )
            : t(
                "Para responder em áudio, cadastre a chave da OpenRouter em IA › Credenciais. A voz sai pela sua chave, sem nada rodando no servidor.",
              )
        }
        ligado={form.reply_as_audio}
        aoMudar={(v) => patch({ reply_as_audio: v })}
        // Sem serviço instalado só dá para DESLIGAR: quem tirou o serviço depois
        // de ligar precisa conseguir sair do estado quebrado.
        desabilitado={disabled || (!servicoDeVoz && !form.reply_as_audio)}
      />
      {form.reply_as_audio ? (
        // Espelho (migration 0226): texto recebe texto, áudio recebe áudio.
        <LinhaInterruptor
          id="reply_as_audio_mirror"
          titulo={t("Só quando o cliente mandar áudio")}
          descricao={t(
            "Ligado: quem escreve recebe texto, quem manda áudio recebe áudio. Desligado: toda resposta sai em áudio.",
          )}
          ligado={form.reply_as_audio_mirror}
          aoMudar={(v) => patch({ reply_as_audio_mirror: v })}
          desabilitado={disabled}
        />
      ) : null}
      {form.reply_as_audio ? (
        <Campo rotulo={t("Voz")} htmlFor="audio_voice">
          <Select
            value={form.audio_voice}
            onValueChange={(v) => patch({ audio_voice: v as VozDoAgente })}
            disabled={disabled}
          >
            <SelectTrigger id="audio_voice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(servicoDeVoz ? VOZES_POR_SERVICO[servicoDeVoz] : VOZES_DO_AGENTE).map((voz) => (
                <SelectItem key={voz} value={voz}>
                  {ROTULO_DA_VOZ[voz]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dica texto={t("A voz em que o cliente ouve as respostas.")} />
        </Campo>
      ) : null}
    </Grupo>
  );
}
