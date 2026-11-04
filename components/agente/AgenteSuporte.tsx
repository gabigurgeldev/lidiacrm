"use client";

/**
 * A assistente de suporte in-app: a bolinha no canto, a saudação na primeira
 * visita e o painel de conversa.
 *
 * Montada SÓ no shell autenticado (`app/app/_components/AppShell.tsx`), e só
 * quando há organização ativa — quem fala com a assistente fala sobre a conta
 * em que está. O servidor confere tudo de novo (`app/api/v1/agente/route.ts`):
 * esconder a bolinha é apresentação, não segurança.
 *
 * O nome da assistente e o da marca chegam prontos do layout (servidor). A
 * marca é a resolvida para a organização — nunca um nome escrito aqui.
 */
import {
  ArrowCounterClockwiseIcon,
  ChatCircleDotsIcon,
  PaperPlaneRightIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { cn } from "@/lib/utils";

import { renderizarMarkdown } from "./markdown";

const CHAVE_SAUDACAO = "agente-suporte:saudacao-vista";
const TAMANHO_MAXIMO = 2000;

interface Mensagem {
  role: "user" | "assistant";
  content: string;
  erro?: boolean;
}

interface Estado {
  disponivel: boolean;
  usadas_hoje: number;
  limite: number;
  conversa_id: string | null;
  mensagens: Mensagem[];
}

interface Props {
  nomeDoAgente: string;
  nomeDoProduto: string;
}

function lerSaudacaoVista(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_SAUDACAO) === "1";
  } catch {
    return true; // sem storage: não insiste na saudação a cada página
  }
}

function marcarSaudacaoVista(): void {
  try {
    window.localStorage.setItem(CHAVE_SAUDACAO, "1");
  } catch {
    /* modo privado / storage bloqueado: só não lembra */
  }
}

export function AgenteSuporte({ nomeDoAgente, nomeDoProduto }: Props) {
  const t = useT();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [saudacao, setSaudacao] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [texto, setTexto] = useState("");
  const [limpando, setLimpando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  const apresentacao = t("Olá, eu sou a {nome}, assistente do {produto}")
    .replace("{nome}", nomeDoAgente)
    .replace("{produto}", nomeDoProduto);

  // A saudação aparece uma vez por navegador, um instante depois da tela.
  useEffect(() => {
    if (lerSaudacaoVista()) return;
    const id = window.setTimeout(() => setSaudacao(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await apiClient.get<{ data: Estado }>("/api/v1/agente");
      setEstado(r.data);
    } catch {
      setEstado({ disponivel: false, usadas_hoje: 0, limite: 0, conversa_id: null, mensagens: [] });
    } finally {
      setCarregando(false);
    }
  }, []);

  const abrir = () => {
    setSaudacao(false);
    marcarSaudacaoVista();
    setAberto(true);
    if (!estado) void carregar();
  };

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [estado?.mensagens.length, enviando]);

  useEffect(() => {
    if (aberto && !enviando) campoRef.current?.focus();
  }, [aberto, enviando]);

  const enviar = async (pergunta: string) => {
    const limpa = pergunta.trim();
    if (!limpa || enviando || !estado) return;
    setTexto("");
    setEnviando(true);
    setEstado((e) =>
      e ? { ...e, mensagens: [...e.mensagens, { role: "user", content: limpa }] } : e,
    );
    try {
      const r = await apiClient.post<{
        data: { conversa_id: string; resposta: string; usadas_hoje: number; limite: number };
      }>(
        "/api/v1/agente",
        { mensagem: limpa, conversa_id: estado.conversa_id },
        { timeoutMs: 40_000, semRepetir: true },
      );
      setEstado((e) =>
        e
          ? {
              ...e,
              conversa_id: r.data.conversa_id,
              usadas_hoje: r.data.usadas_hoje,
              limite: r.data.limite,
              mensagens: [...e.mensagens, { role: "assistant", content: r.data.resposta }],
            }
          : e,
      );
    } catch (err) {
      const limite = err instanceof ApiError && err.status === 429;
      const aviso = limite
        ? t("Você atingiu o limite de perguntas de hoje. Amanhã ele renova.")
        : t("Não consegui responder agora. Tente de novo em instantes.");
      setEstado((e) =>
        e
          ? {
              ...e,
              usadas_hoje: limite ? e.limite : e.usadas_hoje,
              mensagens: [...e.mensagens, { role: "assistant", content: aviso, erro: true }],
            }
          : e,
      );
    } finally {
      setEnviando(false);
    }
  };

  const aoEnviar = (ev: FormEvent) => {
    ev.preventDefault();
    void enviar(texto);
  };

  const aoTeclar = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      void enviar(texto);
    }
  };

  const novaConversa = () => {
    setEstado((e) => (e ? { ...e, conversa_id: null, mensagens: [] } : e));
    setTexto("");
  };

  // Apaga o histórico guardado no servidor (todas as conversas desta pessoa
  // nesta organização). O contador do dia não volta — e a tela diz isso.
  const limparHistorico = async () => {
    if (limpando || enviando || !estado) return;
    if (
      !window.confirm(
        t(
          "Apagar todo o seu histórico de conversas com a assistente? As perguntas de hoje continuam contando.",
        ),
      )
    ) {
      return;
    }
    setLimpando(true);
    try {
      await apiClient.delete("/api/v1/agente", undefined, { semRepetir: true });
      setEstado((e) => (e ? { ...e, conversa_id: null, mensagens: [] } : e));
    } catch {
      setEstado((e) =>
        e
          ? {
              ...e,
              mensagens: [
                ...e.mensagens,
                {
                  role: "assistant",
                  content: t("Não consegui apagar o histórico agora. Tente de novo."),
                  erro: true,
                },
              ],
            }
          : e,
      );
    } finally {
      setLimpando(false);
    }
  };

  const esgotado = !!estado && estado.limite > 0 && estado.usadas_hoje >= estado.limite;
  const sugestoes = [
    t("Como conecto meu WhatsApp?"),
    t("Onde convido alguém para a equipe?"),
    t("Quantas conversas estão abertas?"),
  ];
  // No Inbox o canto inferior direito é do botão de enviar mensagem.
  const subir = pathname?.startsWith("/app/inbox");

  return (
    <>
      {!aberto && (
        <div
          className={cn(
            "fixed right-4 z-40 flex-col items-end gap-2 md:right-6",
            // No celular: fora do Inbox a bolinha sobe acima da barra de abas
            // (`BarraInferior`, 56px + área segura); no Inbox ela SAI — a tela
            // é a conversa, e uma bolha flutuando sobre as mensagens e o botão
            // de enviar é o oposto de um mensageiro. No desktop, como antes.
            subir
              ? "bottom-24 hidden md:flex"
              : "bottom-[calc(5rem+env(safe-area-inset-bottom))] flex md:bottom-6",
          )}
        >
          {saudacao && (
            <div
              role="status"
              className="relative max-w-[16rem] rounded-xl border bg-background p-3 pr-8 text-sm text-foreground shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setSaudacao(false);
                  marcarSaudacaoVista();
                }}
                className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={t("Fechar")}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={abrir} className="text-left">
                <span className="font-medium">{apresentacao}</span>
                <span className="mt-1 block text-muted-foreground">
                  {t("Posso ajudar com alguma dúvida?")}
                </span>
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={abrir}
            data-testid="agente-suporte-bolinha"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={t("Abrir assistente {nome}").replace("{nome}", nomeDoAgente)}
          >
            <ChatCircleDotsIcon className="h-6 w-6" weight="fill" />
          </button>
        </div>
      )}

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
          data-testid="agente-suporte-painel"
        >
          <SheetHeader className="border-b px-4 py-3 pr-12 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ChatCircleDotsIcon className="h-5 w-5 text-primary" weight="fill" />
              {nomeDoAgente}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {estado && estado.limite > 0
                ? t("{x} de {y} perguntas hoje")
                    .replace("{x}", String(estado.usadas_hoje))
                    .replace("{y}", String(estado.limite))
                : t("Assistente do {produto}").replace("{produto}", nomeDoProduto)}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
            {carregando && <p className="text-muted-foreground">{t("Carregando…")}</p>}

            {!carregando && estado && estado.mensagens.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted px-3 py-2">
                  <p className="font-medium">{apresentacao}.</p>
                  <p className="mt-1 text-muted-foreground">
                    {t(
                      "Tiro dúvidas sobre como usar o sistema e consulto dados da sua conta. Não faço alterações: eu explico o passo a passo para você.",
                    )}
                  </p>
                </div>
                {estado.disponivel && (
                  <div className="flex flex-wrap gap-2">
                    {sugestoes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void enviar(s)}
                        disabled={esgotado}
                        className="rounded-full border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {estado?.mensagens.map((m, i) => (
              <div
                key={i}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2",
                    m.role === "user"
                      ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                      : m.erro
                        ? "bg-destructive/10 text-foreground"
                        : "bg-muted text-foreground",
                  )}
                >
                  {m.role === "user" ? m.content : renderizarMarkdown(m.content)}
                </div>
              </div>
            ))}

            {enviando && (
              <p className="text-muted-foreground" aria-live="polite">
                {t("{nome} está digitando…").replace("{nome}", nomeDoAgente)}
              </p>
            )}
            <div ref={fimRef} />
          </div>

          <div className="border-t px-4 py-3">
            {estado && !estado.disponivel ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "A assistente está indisponível nesta instalação. Fale com quem administra o sistema.",
                )}
              </p>
            ) : (
              <form onSubmit={aoEnviar} className="space-y-2">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={campoRef}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value.slice(0, TAMANHO_MAXIMO))}
                    onKeyDown={aoTeclar}
                    rows={2}
                    maxLength={TAMANHO_MAXIMO}
                    disabled={enviando || esgotado || !estado}
                    placeholder={esgotado ? t("Limite de hoje atingido") : t("Escreva sua dúvida…")}
                    aria-label={t("Sua pergunta")}
                    className="min-h-[2.5rem] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={enviando || esgotado || !texto.trim() || !estado}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                    aria-label={t("Enviar")}
                  >
                    <PaperPlaneRightIcon className="h-4 w-4" weight="fill" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={novaConversa}
                      disabled={enviando || !estado || estado.mensagens.length === 0}
                      className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                    >
                      <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" />
                      {t("Nova conversa")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void limparHistorico()}
                      disabled={enviando || limpando || !estado}
                      data-testid="agente-suporte-limpar"
                      className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      {t("Limpar histórico")}
                    </button>
                  </div>
                  {texto.length > TAMANHO_MAXIMO - 200 && (
                    <span>
                      {texto.length}/{TAMANHO_MAXIMO}
                    </span>
                  )}
                </div>
              </form>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
