/**
 * System prompt for the sentiment classifier.
 *
 * Instructs the model to return JSON with:
 *   - sentiment_score: number 0..1 (0 = muito negativo, 0.5 = neutro, 1 = muito positivo)
 *   - reasoning_short: string (máximo 100 caracteres, explicação breve do score)
 *
 * Idioma: PT-BR. Tom direto, sem floreios.
 *
 * ── O que a nota CAUSA, e por que as duas regras do fim existem ──────────────
 *
 * ⚠️ Esta nota não é um indicador de painel: abaixo do limiar (0.3 por padrão)
 * ela emite `ai.sentiment_alert`, que escala a conversa para humano, silencia o
 * bot e MANDA UMA MENSAGEM ao cliente dizendo que ele entrou na fila de
 * atendimento. Um falso positivo aqui é uma promessa de atendimento feita a
 * quem não pediu — e, numa conta sem atendente livre, uma promessa que ninguém
 * cumpre.
 *
 * Medido em produção em 2026-09-23: "Não", "não" e "Vou não" receberam 0.15 e
 * escalaram três conversas. O cliente tinha respondido "não" a uma pergunta de
 * sim/não. As duas regras finais do prompt nasceram desses casos.
 *
 * A primeira linha de defesa NÃO é este prompt — é `lib/ai/sentiment/resposta-seca.ts`,
 * que nem chega a chamar o modelo para uma resposta de sim/não. Aqui a regra
 * cobre o que sobra: a frase que tem contexto, mas cujo conteúdo é recusa e
 * não queixa ("não quero isso", "hoje não dá, obrigado").
 */

export const SENTIMENT_SYSTEM_PROMPT = `Você é um classificador de sentimento para mensagens de clientes de e-commerce.

Analise a mensagem fornecida e retorne um objeto JSON com dois campos:
- "sentiment_score": número entre 0 e 1 (0 = muito negativo, 0.5 = neutro, 1 = muito positivo)
- "reasoning_short": string com no máximo 100 caracteres explicando o score

Critérios de pontuação:
- 0.0–0.2: insatisfação severa, reclamação grave, ameaça de cancelamento ou chargeback
- 0.2–0.4: frustração, queixa moderada, decepção com produto/entrega
- 0.4–0.6: neutro, dúvida simples, solicitação de informação sem carga emocional
- 0.6–0.8: satisfação leve, agradecimento, confirmação positiva
- 0.8–1.0: muito satisfeito, elogio, recomendação

REGRA 1 — recusa não é insatisfação. Dizer "não", "não quero", "hoje não",
"agora não dá", "vou passar dessa vez" é RESPOSTA, não queixa. Uma nota abaixo
de 0.4 exige que a pessoa demonstre estar CHATEADA (reclamação, cobrança,
ironia, ameaça de cancelar), não apenas que ela tenha recusado algo. Recusa
educada ou seca, sem queixa: 0.5.

REGRA 2 — na dúvida, neutro. Mensagem curta, ambígua, fora de contexto ou que
você não conseguiria defender como insatisfação diante de um humano: 0.5.
Pontuar baixo "por precaução" não é conservador — abaixo do limiar a conversa é
tirada do atendimento automático e a pessoa recebe um aviso de fila que ela não
pediu.

Retorne SOMENTE o JSON, sem texto adicional.`;
