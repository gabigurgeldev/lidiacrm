/**
 * A conexão caiu — e você vê isso na tela em que já está.
 *
 * ─── Por que uma faixa, se o aviso já vai para a Central ───────────────────
 *
 * Porque a Central é uma tela que se ABRE, e ninguém a abre por acaso. A falha
 * que originou este componente não foi a falta do aviso — foi a falta de alguém
 * para lê-lo: a sessão caiu, o estado foi gravado, e a descoberta aconteceu
 * horas depois, quando o dono estranhou o silêncio e foi olhar por conta própria.
 * Um aviso guardado onde ninguém passa repete exatamente esse defeito.
 *
 * Esta faixa aparece em TODA tela de /app — inclusive no inbox, onde a pessoa
 * está justamente quando as mensagens deveriam estar chegando. É o lugar onde a
 * ausência delas é sentida.
 *
 * ─── Por que não é e-mail ──────────────────────────────────────────────────
 *
 * Seria melhor: chega mesmo com o navegador fechado. Mas `RESEND_API_KEY` é
 * opcional e está VAZIA numa instalação real — e um aviso que depende de env
 * opcional é um aviso que não existe justamente em quem instalou sozinho e não
 * configurou nada. A faixa funciona em toda instalação, sem configurar nada.
 * O e-mail é um acréscimo possível depois; a faixa é o que não pode faltar.
 */
"use client";
// Client de propósito, e a razão não é interatividade: a faixa é renderizada
// pelo layout de /app, que é servidor, mas fica DENTRO do `IdiomaProvider`. Um
// componente de servidor não enxerga contexto de client, então ou ele recebia o
// idioma por prop — mudando a assinatura e todo chamador — ou passa a ser
// client e o lê de onde já está. Ele não faz nada de servidor: é Link e prosa.
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { conexoesCaidasDe, type ConexaoCaida } from "@/lib/channels/health";

/**
 * `precisaEscanear` muda o texto do botão, não só a cor: reconectar por QR é uma
 * ação concreta ("Escanear"), enquanto um canal em FAILED exige olhar o que
 * aconteceu antes de agir. Mandar "Escanear" para quem precisa investigar faria
 * a pessoa perder tempo numa tela que não resolve o problema dela.
 */
/**
 * ─── Por que a faixa se atualiza sozinha ───────────────────────────────────
 *
 * `caidas` vem do layout de /app, que é Server Component — e layout do App
 * Router NÃO re-renderiza em navegação client-side. A faixa congelava no estado
 * em que a página foi carregada.
 *
 * Medido numa instalação real: o dono pareou dois números, viu a faixa durante o
 * QR (normal), e continuou lendo "WhatsApp sem nome está desconectado" depois de
 * ambos ficarem WORKING — porque ele navegou pelo menu em vez de recarregar. A
 * consulta do banco no mesmo instante dizia ZERO conexões caídas. Um aviso que
 * mente sobre o presente é pior que aviso nenhum: ensina a ignorar a faixa, que
 * é exatamente o que este componente existe para evitar.
 *
 * O SSR continua entregando o primeiro estado — sem piscar na carga —, e o hook
 * assume depois. `refetchInterval` de 60s e não de 5s: o custo é uma consulta
 * por minuto por aba aberta, e status de conexão não muda em segundos.
 */
const INTERVALO_DE_RECONFERENCIA_MS = 60_000;

export function ConexaoCaidaBanner({ caidas }: { caidas: ConexaoCaida[] }) {
  const t = useT();
  const { data: sessoes } = useChannelSessions({
    refetchInterval: INTERVALO_DE_RECONFERENCIA_MS,
  });

  // Enquanto o cliente não trouxe nada (primeira pintura, ou rota indisponível),
  // vale o que o servidor mandou. Trocar por `[]` faria a faixa PISCAR e sumir
  // numa desconexão real — perder o aviso é o defeito mais caro dos dois.
  const vigentes = sessoes ? conexoesCaidasDe(sessoes) : caidas;
  if (vigentes.length === 0) return null;

  const uma = vigentes.length === 1 ? vigentes[0] : null;
  const precisaEscanear = vigentes.some((c) => c.status === "SCAN_QR_CODE");

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-red-300 bg-red-100/95 px-4 py-2 text-sm text-red-950 backdrop-blur dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-50"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>🔌</span>
        <span>
          {uma ? (
            <>
              WhatsApp <strong className="font-semibold">{uma.apelido}</strong>{" "}
              {t("está desconectado")}
            </>
          ) : (
            <>
              <strong className="font-semibold">
                {vigentes.length} {t("conexões")}
              </strong>{" "}
              {t("de WhatsApp estão desconectadas")}
            </>
          )}
          {` — ${t("nenhuma mensagem entra nem sai.")}`}
        </span>
      </div>
      <Link
        href="/app/connections"
        className="rounded-md border border-red-400 bg-white/70 px-3 py-1 font-medium text-red-950 hover:bg-white dark:border-red-700 dark:bg-red-900/40 dark:text-red-50 dark:hover:bg-red-900/70"
      >
        {precisaEscanear ? t("Escanear o QR") : t("Ver conexões")}
      </Link>
    </div>
  );
}
