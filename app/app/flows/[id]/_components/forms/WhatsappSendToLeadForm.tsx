"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { TIPOS_DE_MENSAGEM_DO_FLUXO } from "@/lib/flow-engine/types";

import { CampoComVariavel } from "./CampoComVariavel";
import { SeletorDeCanal, useConexoesParaEnvio } from "./SeletorDeCanal";
import { SeletorDeModelo } from "./SeletorDeModelo";
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
 *
 * ## Texto livre ou DEFINIÇÃO APROVADA — e por que AQUI isso é uma pergunta
 *
 * No disparo em massa o modo é consequência da conexão, e não uma pergunta: uma
 * campanha sai sempre fora da janela de 24h, então conexão oficial só entrega
 * modelo. Aqui é diferente. Este bloco manda 1:1, e DENTRO da janela a mesma
 * conexão oficial entrega texto livre normalmente — escolher o modelo é o que
 * garante a entrega quando a janela já fechou.
 *
 * As duas regras convivem: quando a conexão escolhida SÓ entrega modelo, a
 * pergunta some e vira uma frase dizendo por quê. Oferecer uma opção que a
 * plataforma recusa é o que faz a mensagem sumir sem erro nenhum.
 */
export function WhatsappSendToLeadForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });
  const tipo = String(config.tipo ?? "texto");
  const ehTexto = tipo === "texto";

  const canalId = (config.canal_id as string | null) ?? null;
  const { data: conexoes } = useConexoesParaEnvio();
  const conexao = (conexoes ?? []).find((c) => c.id === canalId) ?? null;
  // A conexão que SÓ entrega modelo tira a escolha — ver o cabeçalho.
  const soModelo = conexao?.modo === "template";
  const modo = soModelo ? "template" : String(config.modo ?? "freeform");
  const porModelo = modo === "template";

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("O que enviar")}>
        <Campo rotulo={t("Como enviar")}>
          {soModelo ? (
            <p className="text-xs text-muted-foreground" data-testid="so-modelo">
              {t(
                "Esta conexão só entrega modelo aprovado — é regra da plataforma. Escolha o modelo abaixo.",
              )}
            </p>
          ) : (
            <Select
              value={modo}
              // Trocar para modelo força `tipo: "texto"`: o schema recusa modelo
              // com mídia avulsa, e deixar um `tipo` antigo gravado faria o
              // fluxo parar de publicar com um erro num campo que sumiu da tela.
              onValueChange={(v) =>
                mudar({ modo: v, ...(v === "template" ? { tipo: "texto" } : {}) })
              }
            >
              <SelectTrigger data-testid="campo-modo-de-envio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="freeform">{t("Escrever a mensagem")}</SelectItem>
                <SelectItem value="template">{t("Usar um modelo aprovado")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Dica
            texto={
              porModelo
                ? t(
                    "Modelo aprovado sai mesmo fora da janela de 24 horas — é o único caminho quando o cliente não escreve há um dia.",
                  )
                : t(
                    "Texto livre só é entregue dentro da janela de 24 horas numa conexão oficial. Fora dela, use um modelo.",
                  )
            }
          />
        </Campo>

        {porModelo && <SeletorDeModelo canalId={canalId} config={config} mudar={mudar} />}

        {!porModelo && (
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
        )}

        {!porModelo && !ehTexto && (
          <Campo rotulo={t(ROTULO_DA_MIDIA[tipo] ?? "Endereço do arquivo")}>
            <CampoComVariavel
              valor={String(config.media_url ?? "")}
              maxLength={2000}
              placeholder="https://"
              aoMudar={(v) => mudar({ media_url: v })}
              testid="campo-endereco-da-midia"
            />
            <Dica
              texto={t(
                "O arquivo precisa estar num endereço público — o WhatsApp busca por lá na hora de enviar.",
              )}
            />
          </Campo>
        )}

        {!porModelo && (
          <Campo rotulo={ehTexto ? t("Mensagem") : t("Legenda (opcional)")}>
            <CampoComVariavel
              multilinha
              linhas={ehTexto ? 6 : 3}
              maxLength={4000}
              valor={String(config.texto ?? "")}
              aoMudar={(v) => mudar({ texto: v })}
              testid="campo-texto-ao-cliente"
            />
          </Campo>
        )}
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por onde enviar")}
        </p>
        <SeletorDeCanal
          valor={canalId}
          aoEscolher={(id) => {
            // Trocar para uma conexão que só entrega modelo GRAVA o modo. Sem
            // isto, a tela mostraria o seletor de modelo (porque `soModelo` é
            // derivado) e o grafo publicado continuaria dizendo "freeform" — a
            // execução mandaria texto livre e a plataforma recusaria em silêncio.
            const nova = (conexoes ?? []).find((c) => c.id === id) ?? null;
            mudar({
              canal_id: id,
              ...(nova?.modo === "template" ? { modo: "template", tipo: "texto" } : {}),
            });
          }}
        />
      </div>
    </div>
  );
}
