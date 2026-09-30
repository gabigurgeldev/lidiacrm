/**
 * TRABALHO QUE PODE ESPERAR O PROVEDOR RECEBER O 200.
 *
 * A mensagem do cliente é gravada em milissegundos, mas o webhook só respondia
 * depois de andar o pipeline inteiro (ticks de follow-up + dreno de até 50
 * eventos: IA, sentimento, mídia, fluxos). Com o WhatsApp por QR isso virava
 * segundos por mensagem — o provedor esperava, estourava o tempo, reentregava,
 * e as próximas mensagens da mesma sessão enfileiravam atrás. Na tela: "demora
 * muito pra chegar no CRM".
 *
 * `after()` do Next roda o trabalho DEPOIS de a resposta sair, no mesmo processo
 * (o self-host é Node de longa duração, não serverless), e o erro fica no log.
 *
 * Fora de uma request (worker, teste, script) `after` lança — aí o trabalho roda
 * na hora, esperado, exatamente como antes. Nenhum chamador perde o efeito.
 */
import { after } from "next/server";

import { logger } from "@/lib/logger";

export async function depoisDaResposta(
  rotulo: string,
  trabalho: () => Promise<void>,
): Promise<void> {
  const protegido = async () => {
    try {
      await trabalho();
    } catch (err) {
      logger.warn(`${rotulo}: falhou depois da resposta`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  try {
    after(protegido);
  } catch {
    await protegido();
  }
}
