"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * ADICIONAR MATERIAL AO ACERVO.
 *
 * A versão anterior era um diálogo por SLOT: quatro cartões fixos, e o de FAQ
 * abria um textarea. Não havia como escolher o tipo, não havia como enviar
 * arquivo (a rota existia e nenhuma tela a chamava), e não havia uma palavra
 * sobre a chave de que a indexação depende.
 *
 * Três decisões:
 *
 *  1. **O tipo é escolhido primeiro**, porque é ele que muda o que se pede a
 *     seguir. Perguntar "cole o conteúdo" antes de saber se é um PDF é como
 *     pedir o endereço antes de perguntar se a entrega é digital.
 *  2. **Documento aceita arquivo OU texto colado.** Quem tem o PDF envia; quem
 *     tem o texto na cabeça cola. Os dois terminam no mesmo lugar.
 *  3. **A falta de chave é dita ANTES**, com o conserto na própria tela. Subir
 *     um arquivo de 8 MB e só então descobrir que ele não vai ser preparado é a
 *     pior ordem possível.
 *
 * **Foto** é o único tipo em que o arquivo é OBRIGATÓRIO e vem acompanhado de
 * uma descrição também obrigatória: o agente acha a foto pelo texto, não pela
 * imagem. O formato e o tamanho são conferidos aqui, com as MESMAS regras da
 * rota (`lib/ai/rag/imagem.ts`), para a pessoa não esperar o upload terminar só
 * para ouvir "formato não suportado".
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  TIPOS_DE_FONTE,
  TIPO_DE_FONTE_POR_ID,
  aceitaArquivo,
  eImagem,
  ePerguntaEResposta,
  ePreenchidoPorRotina,
  type TipoDeFonteId,
} from "@/lib/ai/rag/tipos-de-fonte";
import {
  ACCEPT_DE_FOTO,
  DESCRICAO_DA_FOTO_MAX,
  DESCRICAO_DA_FOTO_MIN,
  TAMANHO_MAXIMO_DA_FOTO,
  eMimeDeFoto,
} from "@/lib/ai/rag/imagem";

// Os DOIS exemplos ficam em português de propósito. O de FAQ é obrigação:
// `## Pergunta:`/`## Resposta:` são os marcadores que
// `lib/ai/rag/ingest/faq.ts` casa por regex de língua fixa, e um exemplo
// traduzido ensinaria um formato que o parser recusa. O de documento vai junto
// porque meio exemplo traduzido, meio não, dentro do mesmo campo, lê pior que
// os dois iguais.
const EXEMPLO_FAQ = `## Pergunta: Qual o prazo de entrega?
## Resposta: De 2 a 3 dias úteis após a confirmação do pagamento.

## Pergunta: Vocês fazem troca?
## Resposta: Sim, em até 30 dias, com o produto sem uso.`;

const EXEMPLO_DOCUMENTO = `# Política de troca

Aceitamos troca em até 30 dias da entrega, com o produto sem uso e na embalagem
original. O frete de devolução é por nossa conta quando o defeito for de fábrica.`;

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onCriado: () => void;
  /** Quando falso, o diálogo avisa que o material vai ficar esperando. */
  podeIndexar: boolean;
}

export function NovoMaterialDialog({ aberto, onFechar, onCriado, podeIndexar }: Props) {
  const t = useT();
  const [tipo, setTipo] = useState<TipoDeFonteId>("faq");
  const [nome, setNome] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [descricao, setDescricao] = useState("");
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const meta = TIPO_DE_FONTE_POR_ID.get(tipo);
  const porRotina = ePreenchidoPorRotina(tipo);
  const foto = eImagem(tipo);

  // A prévia é um `blob:` que segura o arquivo inteiro na memória da aba.
  // Revogada quando muda (troca de foto) e quando o diálogo desmonta.
  useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa);
    };
  }, [previa]);

  function limparArquivo(): void {
    setArquivo(null);
    setPrevia(null);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  function limpar(): void {
    setNome("");
    setConteudo("");
    setDescricao("");
    limparArquivo();
  }

  /**
   * Foto e documento não compartilham arquivo: um PDF escolhido como documento
   * não pode seguir para a rota de foto só porque a pessoa trocou de cartão.
   */
  function trocarTipo(novo: TipoDeFonteId): void {
    if (eImagem(novo) !== foto) limparArquivo();
    setTipo(novo);
  }

  function escolherFoto(f: File | null): void {
    if (!f) {
      limparArquivo();
      return;
    }
    if (!eMimeDeFoto(f.type)) {
      toast.error(
        t("Essa foto não está em JPG, PNG ou WebP. Salve-a num desses formatos e tente de novo."),
      );
      limparArquivo();
      return;
    }
    if (f.size > TAMANHO_MAXIMO_DA_FOTO) {
      toast.error(t("A foto passou de 5 MB, o limite do WhatsApp. Envie uma versão menor."));
      limparArquivo();
      return;
    }
    setArquivo(f);
    setPrevia(URL.createObjectURL(f));
  }

  /** Devolve `true` quando a foto foi guardada; o erro já foi dito na tela. */
  async function enviarFoto(nomeLimpo: string): Promise<boolean> {
    if (!arquivo) {
      toast.error(t("Escolha a foto que o agente vai poder enviar."));
      return false;
    }
    const descricaoLimpa = descricao.trim();
    if (descricaoLimpa.length < DESCRICAO_DA_FOTO_MIN) {
      toast.error(t("Descreva o que a foto mostra — é por esse texto que o agente a encontra."));
      return false;
    }
    if (descricaoLimpa.length > DESCRICAO_DA_FOTO_MAX) {
      toast.error(t("A descrição passou do limite de 2.000 caracteres."));
      return false;
    }

    const form = new FormData();
    form.append("file", arquivo);
    form.append("name", nomeLimpo);
    form.append("descricao", descricaoLimpa);
    const res = await fetch("/api/v1/ai/knowledge/sources/imagem", {
      method: "POST",
      body: form,
    });
    if (res.ok) return true;
    // Um 413 do proxy na frente do app chega como HTML, não no envelope de erro
    // da API: ler o JSON sem rede de proteção trocaria a mensagem útil por um
    // erro de parse.
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    toast.error(json.error?.message ? t(json.error.message) : t("Não consegui guardar a foto."));
    return false;
  }

  async function criar(): Promise<void> {
    const nomeLimpo = nome.trim();
    if (nomeLimpo.length < 2) {
      toast.error(t("Dê um nome ao material — é assim que você o encontra depois."));
      return;
    }
    if (!foto && !arquivo && conteudo.trim().length === 0) {
      toast.error(t("Envie um arquivo ou cole o conteúdo."));
      return;
    }

    setEnviando(true);
    try {
      if (foto) {
        if (!(await enviarFoto(nomeLimpo))) return;
      } else if (arquivo) {
        const form = new FormData();
        form.append("file", arquivo);
        form.append("name", nomeLimpo);
        const res = await fetch("/api/v1/ai/knowledge/sources/upload", {
          method: "POST",
          body: form,
        });
        const json = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) {
          toast.error(json.error?.message ? t(json.error.message) : t("Não consegui guardar o arquivo."));
          return;
        }
      } else {
        await apiClient.post("/api/v1/ai/knowledge/sources", {
          source_type: tipo,
          name: nomeLimpo,
          markdown_blob: conteudo,
        });
      }

      toast.success(
        podeIndexar
          ? t("Material cadastrado. Estou preparando — em instantes o agente já sabe.")
          : t("Material cadastrado. Ele fica esperando uma chave da OpenAI ou da OpenRouter para ser preparado."),
      );
      limpar();
      onCriado();
      onFechar();
    } catch (err) {
      showApiError(err);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      {/* O CORPO ROLA, O RODAPÉ FICA.
          Sem isto o diálogo cresce até empurrar "Adicionar ao acervo" para fora
          da tela: num monitor de 720px de altura o botão existia e era
          inalcançável — medido pelo e2e, que não conseguiu clicar nele. Um
          formulário cujo botão de enviar não cabe na tela é um formulário que
          não se envia. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Ensinar algo novo ao agente")}</DialogTitle>
          <DialogDescription>
            {t("Ele consulta este material antes de responder sobre o seu negócio.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>{t("Que tipo de material é")}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="material-tipos">
              {/* `tf`, e não `t`: o `t` do `useT()` já ocupa o nome aqui. */}
              {TIPOS_DE_FONTE.map((tf) => {
                const rotina = ePreenchidoPorRotina(tf.id);
                const marcado = tipo === tf.id;
                return (
                  <button
                    key={tf.id}
                    type="button"
                    disabled={rotina || enviando}
                    onClick={() => trocarTipo(tf.id)}
                    data-testid={`material-tipo-${tf.id}`}
                    className={[
                      "rounded-lg border p-3 text-left text-sm transition",
                      marcado ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
                      rotina ? "cursor-not-allowed opacity-50" : "",
                    ].join(" ")}
                  >
                    <span className="font-medium">{t(tf.rotulo)}</span>
                    <span className="mt-1 block text-xs text-text-muted">{t(tf.oQueE)}</span>
                  </button>
                );
              })}
            </div>
            {porRotina && meta?.comoChega ? (
              <p className="text-xs text-text-muted">{t(meta.comoChega)}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="material-nome">{t("Nome do material")}</Label>
            <Input
              id="material-nome"
              data-testid="material-nome"
              placeholder={
                tipo === "faq"
                  ? t("Perguntas frequentes da loja")
                  : foto
                    ? t("Jumbo cor 1B")
                    : t("Política de troca")
              }
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={enviando || porRotina}
            />
          </div>

          {aceitaArquivo(tipo) ? (
            <div className="space-y-2">
              <Label htmlFor="material-arquivo">{t("Arquivo (opcional)")}</Label>
              <Input
                id="material-arquivo"
                data-testid="material-arquivo"
                ref={inputArquivo}
                type="file"
                accept=".pdf,.md,.txt"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                disabled={enviando}
              />
              <p className="text-xs text-text-muted">
                {t(
                  "PDF, Markdown ou texto, até 20 MB. Um PDF só de imagens escaneadas não tem letra nenhuma para ler — envie uma versão com texto selecionável.",
                )}
              </p>
            </div>
          ) : null}

          {foto ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="material-foto">{t("Foto")}</Label>
                <Input
                  id="material-foto"
                  data-testid="material-foto"
                  ref={inputArquivo}
                  type="file"
                  accept={ACCEPT_DE_FOTO}
                  onChange={(e) => escolherFoto(e.target.files?.[0] ?? null)}
                  disabled={enviando}
                />
                <p className="text-xs text-text-muted">
                  {t("JPG, PNG ou WebP, até 5 MB — o limite do WhatsApp.")}
                </p>
                {previa ? (
                  <div className="overflow-hidden rounded-md border border-border bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:), não há o que otimizar */}
                    <img
                      src={previa}
                      alt={t("Prévia da foto escolhida")}
                      className="mx-auto max-h-56 w-auto object-contain"
                      data-testid="material-foto-previa"
                    />
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="material-descricao">{t("O que a foto mostra")}</Label>
                <Textarea
                  id="material-descricao"
                  data-testid="material-descricao"
                  rows={4}
                  maxLength={DESCRICAO_DA_FOTO_MAX}
                  placeholder={t(
                    "Jumbo cor 1B, 400 g, pacote. Temos também nas cores 27, 30 e 613.",
                  )}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  disabled={enviando}
                />
                <p className="text-xs text-text-muted">
                  {t(
                    "Obrigatória. O agente não vê a foto ao procurar — ele acha pela descrição. Escreva o que o cliente perguntaria: produto, cor, tamanho, modelo.",
                  )}
                </p>
              </div>
            </>
          ) : null}

          {!porRotina && !foto && !arquivo ? (
            <div className="space-y-2">
              <Label htmlFor="material-conteudo">
                {aceitaArquivo(tipo) ? t("…ou cole o texto aqui") : t("Conteúdo")}
              </Label>
              <Textarea
                id="material-conteudo"
                data-testid="material-conteudo"
                rows={10}
                placeholder={ePerguntaEResposta(tipo) ? EXEMPLO_FAQ : EXEMPLO_DOCUMENTO}
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
                disabled={enviando}
              />
              {ePerguntaEResposta(tipo) ? (
                <p className="text-xs text-text-muted">
                  {t("Uma linha")} <code>## Pergunta:</code> {t("e uma")}{" "}
                  <code>## Resposta:</code> {t("por item, separados por uma linha em branco.")}
                </p>
              ) : null}
            </div>
          ) : null}

          {!podeIndexar ? (
            <p className="text-xs text-warning-fg" data-testid="material-aviso-sem-chave">
              {t(
                "Sem uma chave da OpenAI ou da OpenRouter, o material fica guardado e esperando — o agente só passa a conhecê-lo depois que a chave for cadastrada.",
              )}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            {t("Cancelar")}
          </Button>
          <Button onClick={criar} disabled={enviando || porRotina} data-testid="material-criar">
            {enviando ? t("Guardando…") : t("Adicionar ao acervo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
