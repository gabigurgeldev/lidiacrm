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
import { TIPOS_DE_MENSAGEM_DO_FLUXO } from "@/lib/flow-engine/types";

import { SeletorDeCanal } from "./SeletorDeCanal";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** O nome de cada tipo na tela. O valor cru nunca aparece. */
const ROTULO_DO_TIPO: Record<string, string> = {
  texto: "Texto",
  imagem: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  arquivo: "Arquivo",
};

/** Como chamar o endereço do arquivo, por tipo — "foto" ajuda mais que "mídia". */
const ROTULO_DA_MIDIA: Record<string, string> = {
  imagem: "Endereço da imagem",
  audio: "Endereço do áudio",
  video: "Endereço do vídeo",
  arquivo: "Endereço do arquivo",
};

/**
 * `whatsapp.send_to_lead` — a mensagem que o CLIENTE recebe.
 *
 * Duas seções, e a divisão não é enfeite: "o quê" e "por onde" são decisões
 * independentes, e juntá-las numa pilha de seis campos foi o que fez o painel
 * antigo parecer um formulário de cadastro.
 */
export function WhatsappSendToLeadForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const tipo = String(config.tipo ?? "texto");
  const ehTexto = tipo === "texto";

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("O que enviar")}>
        <Campo rotulo={t("Tipo de mensagem")}>
          <Select value={tipo} onValueChange={(v) => mudar({ tipo: v })}>
            <SelectTrigger data-testid="campo-tipo-da-mensagem">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/*
                A lista sai de `TIPOS_DE_MENSAGEM_DO_FLUXO`, a mesma que o
                adapter traduz para o `type` da mensagem. Repetir os valores aqui
                à mão criaria a divergência silenciosa de sempre: a tela oferece
                um tipo que o envio não sabe mandar.
              */}
              {TIPOS_DE_MENSAGEM_DO_FLUXO.map((valor) => (
                <SelectItem key={valor} value={valor}>
                  {t(ROTULO_DO_TIPO[valor] ?? valor)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        {!ehTexto && (
          <Campo rotulo={t(ROTULO_DA_MIDIA[tipo] ?? "Endereço do arquivo")}>
            <Input
              value={String(config.media_url ?? "")}
              maxLength={2000}
              placeholder="https://"
              onChange={(e) => mudar({ media_url: e.target.value })}
              data-testid="campo-endereco-da-midia"
            />
            <Dica
              texto={t(
                "O arquivo precisa estar num endereço público — o WhatsApp busca por lá na hora de enviar.",
              )}
            />
          </Campo>
        )}

        <Campo rotulo={ehTexto ? t("Mensagem") : t("Legenda (opcional)")}>
          <Textarea
            rows={ehTexto ? 6 : 3}
            maxLength={4000}
            value={String(config.texto ?? "")}
            onChange={(e) => mudar({ texto: e.target.value })}
            data-testid="campo-texto-ao-cliente"
          />
          <Dica
            texto={t(
              "Use {{lead.title}}, {{contact.name}} e {{lead.score}} para incluir os dados do lead.",
            )}
          />
        </Campo>
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por onde enviar")}
        </p>
        <SeletorDeCanal
          valor={(config.canal_id as string | null) ?? null}
          aoEscolher={(id) => mudar({ canal_id: id })}
        />
      </div>
    </div>
  );
}
