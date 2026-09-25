"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useImportarLista, type RecorteDaPlanilha } from "@/hooks/bulk-send/useImportarLista";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { lerConteudo } from "@/lib/channels/template-conteudo";
import { Warning } from "@/lib/ui/icons";

/**
 * O WIZARD — quatro passos, e o quarto é obrigatório.
 *
 * ═══ Por que passos, e não um formulário só ═══
 *
 * Porque as perguntas são DEPENDENTES. O modo (texto livre ou modelo aprovado)
 * só existe depois de escolhida a conexão; os campos do modelo só existem
 * depois de escolhido o modelo. Um formulário único teria de renderizar campos
 * impossíveis e depois escondê-los.
 *
 * ═══ Por que o passo de confirmação não é pulável ═══
 *
 * Porque enviar mensagem é irreversível. O botão não diz "Confirmar": diz para
 * quantas pessoas, por qual número. Quem clica sabe o tamanho do que está
 * fazendo.
 *
 * ═══ A tela não sabe o nome do canal ═══
 *
 * `/api/v1/bulk-sends/conexoes` devolve vocabulário de produto — "aceita texto
 * livre", "no mínimo 6 segundos", "hoje manda no máximo 50". A régua do piso e
 * o teto de aquecimento são calculados LÁ, pelas mesmas funções do motor.
 */

interface Conexao {
  id: string;
  rotulo: string;
  telefone: string | null;
  conectada: boolean;
  modo: "freeform" | "template";
  piso_ms: number;
  piso_origem: "numero" | "canal";
  cobra_por_mensagem: boolean;
  risco_de_banimento: boolean;
  teto_de_hoje: number | null;
  em_aquecimento: boolean;
  janela: { inicio: number; fim: number; fuso: string };
  /** De onde vêm os modelos aprovados DESTA conexão. Rótulo neutro, nunca o canal. */
  fonte_de_modelos: "oficial" | "parceiro" | null;
}

/** O que as duas rotas de modelos devolvem, do que o disparo precisa. */
interface ModeloAprovado {
  name: string;
  language: string;
  status: string;
  components?: unknown[];
  slots?: Array<{ key: string; expects: string; onde: string }>;
}

/**
 * A rota de cada fonte. Mesmo mapa de `SeletorDeModelo` (bloco de fluxo): a
 * tela recebe o rótulo neutro e monta a URL, sem saber qual é o canal.
 */
const ROTA_DA_FONTE: Record<"oficial" | "parceiro", string> = {
  oficial: "/api/v1/channels/templates",
  parceiro: "/api/v1/channels/partner/templates",
};

/** Vem do hook que fala com a rota — uma definição só, do lado de quem a lê. */
type Recorte = RecorteDaPlanilha;

const NOMES_DOS_MOTIVOS: Record<string, string> = {
  contact_blocked: "pediram para parar",
  consent_declined: "recusaram marketing",
  no_phone: "sem telefone",
  contact_anonymized: "anonimizados",
  contact_merged: "mesclados com outro",
};

export function NovoDisparoDialog({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();

  const [passo, setPasso] = React.useState(1);
  const [nome, setNome] = React.useState("");
  const [conexaoId, setConexaoId] = React.useState<string | null>(null);
  const [corpo, setCorpo] = React.useState("");
  const [intervaloSegundos, setIntervaloSegundos] = React.useState(30);
  const [agendarPara, setAgendarPara] = React.useState("");
  const [recorte, setRecorte] = React.useState<Recorte | null>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  /** `nome|idioma` do modelo escolhido — o par é a identidade da definição. */
  const [modeloChave, setModeloChave] = React.useState("");
  const [valores, setValores] = React.useState<Record<string, string>>({});
  /** A lacuna cuja imagem está subindo agora — trava o botão só dela. */
  const [subindoImagem, setSubindoImagem] = React.useState<string | null>(null);

  /**
   * Sobe a imagem do cabeçalho e guarda o LINK como valor da lacuna.
   *
   * Pedir "cole o link público da imagem" era pedir o que o operador não tem. A
   * rota é a mesma da criação de modelos; `uso=disparo` pede um link que dure a
   * campanha inteira, porque cada mensagem manda o mesmo link e a Meta baixa a
   * imagem a cada envio.
   */
  async function subirImagem(chave: string, arquivo: File) {
    setSubindoImagem(chave);
    try {
      const fd = new FormData();
      fd.append("file", arquivo);
      fd.append("uso", "disparo");
      const r = await fetch("/api/v1/channels/partner/templates/media", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { url?: string };
        error?: { message?: string };
      };
      if (!r.ok || !j.data?.url) {
        toast.error(t(j.error?.message ?? "Não consegui subir a imagem."));
        return;
      }
      setValores((v) => ({ ...v, [chave]: j.data!.url! }));
    } finally {
      setSubindoImagem(null);
    }
  }

  const { data: conexoes } = useQuery({
    queryKey: ["bulk-send-conexoes"],
    queryFn: async () => apiClient.get<{ data: Conexao[] }>("/api/v1/bulk-sends/conexoes"),
    select: (r) => r.data,
    enabled: aberto,
  });

  const conexao = (conexoes ?? []).find((c) => c.id === conexaoId) ?? null;
  const pisoSegundos = conexao ? Math.ceil(conexao.piso_ms / 1000) : 1;

  // ─── Os modelos aprovados DESTA conexão ─────────────────────────────────────
  //
  // Antes, o disparo por um número oficial parava aqui com um aviso mandando o
  // operador "escolher o modelo em Conexões e voltar" — e não havia volta: nada
  // em Conexões dispara. O motor sempre soube enviar por modelo; faltava a tela
  // deixar escolher. A lista é por conexão porque a definição é aprovada POR
  // CONTA, e oferecer o modelo de outra conta é um envio que a plataforma recusa.
  const fonte = conexao?.modo === "template" ? conexao.fonte_de_modelos : null;
  const { data: modelos, isLoading: carregandoModelos } = useQuery({
    queryKey: ["modelos-da-conexao", fonte, conexaoId],
    enabled: aberto && fonte !== null && conexaoId !== null,
    queryFn: async () =>
      apiClient.get<{ data: { templates?: ModeloAprovado[] } }>(
        `${ROTA_DA_FONTE[fonte!]}?canal_id=${conexaoId}`,
      ),
    select: (r) => (r.data.templates ?? []).filter((m) => m.status?.toUpperCase() === "APPROVED"),
    staleTime: 30_000,
  });
  const modelo =
    (modelos ?? []).find((m) => `${m.name}|${m.language}` === modeloChave) ?? null;
  const lacunas = modelo?.slots ?? [];
  const conteudoDoModelo = modelo ? lerConteudo(modelo.components) : null;
  const faltaValor = lacunas.some((l) => !(valores[l.key] ?? "").trim());
  const podeSeguirDoPasso2 =
    conexao !== null &&
    (conexao.modo === "freeform"
      ? corpo.trim() !== ""
      : modelo !== null && !faltaValor && subindoImagem === null);

  /**
   * O intervalo que vale — nunca abaixo do piso da conexão.
   *
   * DERIVADO no render, e não sincronizado por efeito: trocar de número muda o
   * piso, e um `useEffect` que corrigisse o estado renderizaria uma vez com o
   * valor errado antes de consertar. Aqui não existe o instante errado, e o
   * `lint` de `set-state-in-effect` fica satisfeito pelo motivo certo.
   *
   * A trava não é enfeite: mandar mais rápido que o piso é o que queima o
   * número do cliente. O servidor aplica o piso de qualquer jeito
   * (`lib/bulk-send/ritmo.ts`); a tela existe para não prometer o que ele não
   * vai fazer.
   */
  const intervaloValido = Math.max(intervaloSegundos, pisoSegundos);

  // `useImportarLista` usa fetch cru: o `apiClient` serializa body como JSON e
  // não fala FormData — mesmo motivo de `hooks/contacts/useImportContacts.ts`.
  const subirPlanilha = useImportarLista();

  const criar = useMutation({
    mutationFn: async () =>
      apiClient.post<{ data: { id: string } }>("/api/v1/bulk-sends", {
        name: nome,
        channel_session_id: conexaoId,
        mode: conexao?.modo ?? "freeform",
        // Só o conteúdo do modo escolhido: um `body` vazio num disparo por
        // modelo reprova a validação (texto mínimo de 1 caractere).
        ...(conexao?.modo === "template"
          ? {
              template_name: modelo?.name,
              template_language: modelo?.language,
              template_values: valores,
            }
          : { body: corpo }),
        interval_ms: intervaloValido * 1000,
        scheduled_for: agendarPara ? new Date(agendarPara).toISOString() : undefined,
        audiencia: { kind: "file", contact_ids: recorte?.contact_ids ?? [] },
      }),
    onError: showApiError,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["bulk-sends"] });
      toast.success(t("Disparo criado. Confira e dispare quando quiser."));
      aoFechar();
      router.push(`/app/disparos/${r.data.id}`);
    },
  });

  function fechar() {
    setPasso(1);
    setNome("");
    setConexaoId(null);
    setCorpo("");
    setRecorte(null);
    setArquivo(null);
    setAgendarPara("");
    setModeloChave("");
    setValores({});
    setSubindoImagem(null);
    aoFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Novo disparo")}</DialogTitle>
          <DialogDescription>
            {t("Passo {n} de 4").replace("{n}", String(passo))}
          </DialogDescription>
        </DialogHeader>

        {/* ─── 1. Com quem falar ─────────────────────────────────────────── */}
        {passo === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nome-do-disparo">{t("Nome do disparo")}</Label>
              <Input
                id="nome-do-disparo"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={t("Promoção de setembro")}
              />
              <p className="text-xs text-muted-foreground">
                {t("Só para você achar depois. O contato não vê esse nome.")}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="planilha">{t("Planilha de contatos (.csv)")}</Label>
              <Input
                id="planilha"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "Precisa ter uma coluna de telefone. No Excel use 'Salvar como' → 'CSV UTF-8'. Quem já está na sua base entra também, sem duplicar.",
                )}
              </p>
            </div>
          </div>
        )}

        {/* ─── 2. Por onde e o quê ───────────────────────────────────────── */}
        {passo === 2 && (
          <div className="flex flex-col gap-4">
            {recorte && <ResumoDoRecorte recorte={recorte} t={t} />}

            <div className="flex flex-col gap-2">
              <Label>{t("Por qual número enviar")}</Label>
              <div className="flex flex-col gap-2">
                {(conexoes ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setConexaoId(c.id);
                      // Modelo é por conta: o da conexão anterior não existe nesta.
                      setModeloChave("");
                      setValores({});
                    }}
                    className={`rounded-md border p-3 text-left text-sm transition-colors ${
                      conexaoId === c.id ? "border-primary bg-muted/50" : "hover:bg-muted/30"
                    }`}
                  >
                    <span className="font-medium">{c.rotulo}</span>
                    {!c.conectada && (
                      <span className="ml-2 text-xs text-destructive">
                        {t("desconectado — o disparo espera reconectar")}
                      </span>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.modo === "template"
                        ? t("Só envia modelo aprovado.")
                        : t("Envia texto livre.")}{" "}
                      {t("No mínimo {s}s entre mensagens.").replace(
                        "{s}",
                        String(Math.ceil(c.piso_ms / 1000)),
                      )}
                      {c.teto_de_hoje !== null &&
                        ` ${t("Hoje: até {n} mensagens.").replace("{n}", String(c.teto_de_hoje))}`}
                      {c.cobra_por_mensagem && ` ${t("Este canal cobra por mensagem.")}`}
                    </p>
                  </button>
                ))}
                {(conexoes ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("Nenhuma conexão de WhatsApp. Conecte um número em Conexões primeiro.")}
                  </p>
                )}
              </div>
            </div>

            {conexao?.modo === "freeform" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="corpo">{t("Mensagem")}</Label>
                <Textarea
                  id="corpo"
                  rows={5}
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  placeholder={t("Escreva a mensagem que todos vão receber.")}
                />
              </div>
            )}

            {conexao?.modo === "template" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="modelo">{t("Modelo aprovado")}</Label>
                  {carregandoModelos ? (
                    <p className="text-sm text-muted-foreground">{t("Carregando os modelos…")}</p>
                  ) : (modelos ?? []).length === 0 ? (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                      <Warning className="mr-2 inline size-4" />
                      {t(
                        "Nenhum modelo aprovado nesta conexão. Crie ou sincronize em Conexões › Provedor parceiro › Modelos do parceiro e volte aqui.",
                      )}
                    </div>
                  ) : (
                    <select
                      id="modelo"
                      value={modeloChave}
                      onChange={(e) => {
                        setModeloChave(e.target.value);
                        // Trocar de modelo ZERA os valores: as lacunas de um não
                        // são as do outro, e o texto sairia certo no lugar errado.
                        setValores({});
                      }}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">{t("Escolha o modelo")}</option>
                      {(modelos ?? []).map((m) => (
                        <option key={`${m.name}|${m.language}`} value={`${m.name}|${m.language}`}>
                          {m.name} ({m.language})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {conteudoDoModelo?.body && (
                  <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
                    {conteudoDoModelo.body}
                  </p>
                )}

                {/* Um campo por lacuna do modelo. O valor é o MESMO para todos os
                    destinatários — o disparo não troca por contato. */}
                {lacunas.map((l) =>
                  l.expects === "image" ? (
                    // IMAGEM, não texto: o cabeçalho de mídia pede o arquivo, e o
                    // envio o manda como imagem. Um campo de texto aqui convidava a
                    // digitar uma frase, que a Meta recusa em toda mensagem.
                    <div key={l.key} className="flex flex-col gap-2">
                      <Label htmlFor={`valor-${l.key}`}>
                        {t("Imagem do cabeçalho")}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({t("JPG ou PNG, até 5 MB")})
                        </span>
                      </Label>
                      <div className="flex items-center gap-3">
                        {valores[l.key] && (
                          // eslint-disable-next-line @next/next/no-img-element -- link assinado do storage, fora do otimizador
                          <img
                            src={valores[l.key]}
                            alt={t("Imagem do cabeçalho")}
                            className="size-16 rounded-md border object-cover"
                          />
                        )}
                        <label className="cursor-pointer rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
                          {subindoImagem === l.key
                            ? t("Subindo…")
                            : valores[l.key]
                              ? t("Trocar imagem")
                              : t("Subir imagem (JPG/PNG)")}
                          <input
                            id={`valor-${l.key}`}
                            type="file"
                            accept="image/jpeg,image/png"
                            className="hidden"
                            disabled={subindoImagem !== null}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void subirImagem(l.key, f);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div key={l.key} className="flex flex-col gap-1">
                      <Label htmlFor={`valor-${l.key}`}>
                        {t("Valor de {k}").replace("{k}", `{{${l.key}}}`)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">({l.onde})</span>
                      </Label>
                      <Input
                        id={`valor-${l.key}`}
                        value={valores[l.key] ?? ""}
                        onChange={(e) => setValores({ ...valores, [l.key]: e.target.value })}
                        placeholder={
                          l.expects === "text" ? undefined : t("Link público do arquivo (https://…)")
                        }
                      />
                    </div>
                  ),
                )}
                {lacunas.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("Todos os contatos recebem os mesmos valores.")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── 3. Ritmo ──────────────────────────────────────────────────── */}
        {passo === 3 && conexao && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="intervalo">{t("Tempo entre uma mensagem e outra")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="intervalo"
                  type="number"
                  min={pisoSegundos}
                  value={intervaloValido}
                  onChange={(e) =>
                    setIntervaloSegundos(Math.max(pisoSegundos, Number(e.target.value) || pisoSegundos))
                  }
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">{t("segundos")}</span>
              </div>
              {/* O piso é regra, não sugestão — e a tela diz de onde ele vem,
                  porque um dos dois se muda em Conexões e o outro não. */}
              <p className="text-xs text-muted-foreground">
                {conexao.piso_origem === "canal"
                  ? t("Mínimo de {s}s exigido por este canal — não dá para ir mais rápido.").replace(
                      "{s}",
                      String(pisoSegundos),
                    )
                  : t(
                      "Mínimo de {s}s para o número não ser bloqueado. Dá para afrouxar em Conexões, por sua conta e risco.",
                    ).replace("{s}", String(pisoSegundos))}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="agendar">{t("Começar quando")}</Label>
              <Input
                id="agendar"
                type="datetime-local"
                value={agendarPara}
                onChange={(e) => setAgendarPara(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("Deixe em branco para começar assim que você disparar.")}{" "}
                {t("Fora de {i}h–{f}h o envio espera a manhã seguinte, sozinho.")
                  .replace("{i}", String(conexao.janela.inicio))
                  .replace("{f}", String(conexao.janela.fim))}
              </p>
            </div>
          </div>
        )}

        {/* ─── 4. Confirmação ────────────────────────────────────────────── */}
        {passo === 4 && conexao && recorte && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t("Você vai falar com {n} pessoas pelo número {c}.")
                .replace("{n}", String(recorte.vao_receber))
                .replace("{c}", conexao.rotulo)}
            </p>
            {modelo && (
              <p className="text-sm">
                {t("Pelo modelo {m}.").replace("{m}", `${modelo.name} (${modelo.language})`)}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {t("Uma mensagem a cada {s} segundos — pelo menos {m} minutos até a última.")
                .replace("{s}", String(intervaloValido))
                .replace(
                  "{m}",
                  String(Math.max(1, Math.ceil((recorte.vao_receber * intervaloValido) / 60))),
                )}
            </p>
            {conexao.em_aquecimento && conexao.teto_de_hoje !== null && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                {t(
                  "Este número ainda está em aquecimento: hoje saem no máximo {n}, e o resto continua nos próximos dias.",
                ).replace("{n}", String(conexao.teto_de_hoje))}
              </p>
            )}
            {conexao.cobra_por_mensagem && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                {t("Este canal cobra por mensagem enviada.")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("O disparo é criado parado. Você ainda vai conferir e apertar o botão de enviar.")}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {passo > 1 && (
            <Button variant="outline" onClick={() => setPasso(passo - 1)}>
              {t("Voltar")}
            </Button>
          )}
          {passo === 1 && (
            <Button
              disabled={!nome.trim() || !arquivo || subirPlanilha.isPending}
              onClick={() =>
                arquivo &&
                subirPlanilha.mutate(arquivo, {
                  onError: showApiError,
                  onSuccess: (r) => {
                    setRecorte(r);
                    setPasso(2);
                  },
                })
              }
            >
              {subirPlanilha.isPending ? t("Lendo a planilha…") : t("Continuar")}
            </Button>
          )}
          {passo === 2 && (
            <Button
              disabled={!podeSeguirDoPasso2}
              onClick={() => setPasso(3)}
            >
              {t("Continuar")}
            </Button>
          )}
          {passo === 3 && <Button onClick={() => setPasso(4)}>{t("Continuar")}</Button>}
          {passo === 4 && (
            <Button disabled={criar.isPending} onClick={() => criar.mutate()}>
              {criar.isPending
                ? t("Criando…")
                : t("Criar disparo para {n} pessoas").replace(
                    "{n}",
                    String(recorte?.vao_receber ?? 0),
                  )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O recorte honesto, antes de qualquer decisão. É a frase que muda a campanha:
 * ver "19 pediram para parar" aqui pode fazer a pessoa escolher outra lista;
 * ver o mesmo na tela de resultado já é tarde.
 */
function ResumoDoRecorte({ recorte, t }: { recorte: Recorte; t: (s: string) => string }) {
  const fora = Object.entries(recorte.fora_por_motivo);
  const totalFora = fora.reduce((s, [, n]) => s + n, 0) + recorte.repetidos;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">
        {t("{n} vão receber").replace("{n}", String(recorte.vao_receber))}
      </p>
      {totalFora > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("{n} fora:").replace("{n}", String(totalFora))}{" "}
          {[
            ...fora.map(([motivo, n]) => `${n} ${t(NOMES_DOS_MOTIVOS[motivo] ?? motivo)}`),
            ...(recorte.repetidos > 0
              ? [`${recorte.repetidos} ${t("repetidos na planilha")}`]
              : []),
          ].join(" · ")}
        </p>
      )}
      {recorte.linhas_com_erro.length > 0 && (
        <p className="mt-1 text-xs text-destructive">
          {t("{n} linhas da planilha não puderam ser lidas.").replace(
            "{n}",
            String(recorte.linhas_com_erro.length),
          )}
        </p>
      )}
    </div>
  );
}
