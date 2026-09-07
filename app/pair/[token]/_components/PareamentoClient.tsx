"use client";

import { useEffect, useState } from "react";

import { CheckCircle, CircleNotch, Clock, Warning } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * O miolo da página pública de pareamento.
 *
 * ─── Por que um polling próprio, e não o do `ConnectionsClient` ────────────
 *
 * Parecem o mesmo laço e não são: aquele lê a LISTA de sessões autenticadas
 * (`/api/v1/channel-sessions`) e este lê UM status por token, numa rota pública
 * com forma de resposta diferente. Um hook que servisse aos dois teria de
 * abstrair o endpoint e o formato — mais peça para manter do que as dez linhas
 * que economizaria, num arquivo (`ConnectionsClient`) que está em uso.
 *
 * O que É copiado de lá, e de propósito, são os dois NÚMEROS, porque eles foram
 * medidos: status a cada 3s, e QR renovado a cada 15s — o QR do WhatsApp expira
 * em ~20s, e essa folga é o que impede o cliente de escanear um código morto.
 */

type Estado =
  | { fase: "carregando" }
  | { fase: "ok"; linha: string | null; conectado: boolean; expiraEmS: number }
  | { fase: "invalido"; motivo: string };

const MS_ENTRE_STATUS = 3_000;
const MS_ENTRE_QRS = 15_000;

/** `mm:ss` — o contador que a pessoa usa para saber se ainda dá tempo. */
function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PareamentoClient({ token }: { token: string }) {
  const t = useT();
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tick, setTick] = useState(0);

  const conectado = estado.fase === "ok" && estado.conectado;
  const invalido = estado.fase === "invalido";
  // Derivado uma vez: usado como dependência do relógio, e ler `estado.fase`
  // dentro do efeito faria o TS perder o estreitamento na callback.
  const emContagem = estado.fase === "ok" && !estado.conectado;

  // Definido DENTRO do efeito, como o laço irmão do painel de conexões: fora
  // dele a regra `set-state-in-effect` acusa a chamada, e extrair só para
  // silenciar o aviso separaria a função do único lugar que a usa.
  useEffect(() => {
    let cancelado = false;

    const consultar = async () => {
      try {
        const r = await fetch(`/api/v1/pair/${token}/status`, { cache: "no-store" });
        if (cancelado) return;
        if (r.status === 404) {
          const corpo = (await r.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          if (!cancelado) {
            setEstado({ fase: "invalido", motivo: corpo?.error?.message ?? "desconhecido" });
          }
          return;
        }
        // 429/503 são transitórios: manter a tela como está e tentar no próximo
        // tique é melhor que dizer "link inválido" para um link que está válido.
        if (!r.ok) return;
        const corpo = (await r.json()) as {
          data: { linha: string | null; conectado: boolean; expira_em_s: number };
        };
        if (cancelado) return;
        setEstado({
          fase: "ok",
          linha: corpo.data.linha,
          conectado: corpo.data.conectado,
          expiraEmS: corpo.data.expira_em_s,
        });
      } catch {
        // rede oscilando — o próximo tique tenta de novo
      }
    };

    void consultar();
    const iv = setInterval(() => void consultar(), MS_ENTRE_STATUS);
    return () => {
      cancelado = true;
      clearInterval(iv);
    };
  }, [token]);

  // Para de renovar o QR quando conectou ou o link morreu: seguir pedindo
  // imagem depois disso é gastar rede para receber 404.
  useEffect(() => {
    if (conectado || invalido) return;
    const iv = setInterval(() => setTick((v) => v + 1), MS_ENTRE_QRS);
    return () => clearInterval(iv);
  }, [conectado, invalido]);

  // O contador desce sozinho entre uma consulta e outra — sem isto ele daria
  // saltos de 3s e pareceria travado.
  useEffect(() => {
    if (!emContagem) return;
    const iv = setInterval(() => {
      setEstado((atual) =>
        atual.fase === "ok"
          ? { ...atual, expiraEmS: Math.max(0, atual.expiraEmS - 1) }
          : atual,
      );
    }, 1000);
    return () => clearInterval(iv);
  }, [emContagem]);

  if (estado.fase === "carregando") {
    return (
      <div className="ios-grupo flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" aria-hidden />
        {t("Carregando…")}
      </div>
    );
  }

  if (estado.fase === "invalido") {
    const frase =
      estado.motivo === "expirado"
        ? t("Este link expirou. Peça um novo para quem te enviou.")
        : estado.motivo === "usado"
          ? t("Este link já foi usado para conectar um aparelho.")
          : estado.motivo === "cancelado"
            ? t("Este link foi cancelado.")
            : t("Este link não é válido.");
    return (
      <div className="ios-grupo flex flex-col items-center gap-3 p-8 text-center" data-testid="pair-invalido">
        <Warning size={28} aria-hidden className="text-error-fg" />
        <p className="text-sm text-error-fg">{frase}</p>
      </div>
    );
  }

  if (estado.conectado) {
    return (
      <div className="ios-grupo flex flex-col items-center gap-3 p-8 text-center" data-testid="pair-conectado">
        <CheckCircle size={32} weight="fill" aria-hidden className="text-success-fg" />
        <p className="text-base font-medium text-success-fg">{t("Conectado!")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Pode fechar esta página. Não é preciso fazer mais nada.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pair-qr">
      <div className="ios-grupo flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("Você está conectando o WhatsApp de")}
          </p>
          <p className="text-lg font-semibold">{estado.linha ?? t("Número sem nome")}</p>
        </div>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
          <Clock size={14} aria-hidden />
          {t("Expira em")} {relogio(estado.expiraEmS)}
        </span>
      </div>

      <div className="ios-grupo flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-start">
        {/*
          Sem `key={tick}`: trocar só o `src` reaproveita o mesmo <img>, e o
          browser segura o frame anterior até decodificar o novo. Remontar o
          elemento a cada renovação é o que causaria o flash branco.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/v1/pair/${token}/qr?t=${tick}`}
          alt={t("QR Code para conectar WhatsApp")}
          className="h-64 w-64 shrink-0 rounded-md border bg-white p-2"
        />
        <div className="space-y-2 text-sm">
          <p className="font-medium">{t("Escaneie com o WhatsApp")}</p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>{t("Abra o WhatsApp no celular que será conectado.")}</li>
            <li>{t("Toque em Configurações → Aparelhos conectados.")}</li>
            <li>{t("Toque em Conectar um aparelho e aponte para este QR.")}</li>
          </ol>
          <p className="pt-1 text-xs text-muted-foreground">{t("O QR se renova sozinho.")}</p>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {t("Este link é pessoal e expira sozinho. Não repasse para outras pessoas.")}
      </p>
    </div>
  );
}
