-- ============================================================================
-- 0244 — MATERIAL DO TIPO FOTO NO ACERVO DO AGENTE.
--
-- `ai_knowledge_sources` ganha o tipo `imagem`: uma foto (jpeg/png/webp, até
-- 5 MB) com a descrição do que ela mostra. O agente acha a foto pela descrição
-- (um trecho `Foto: {nome}\n{descrição}`) e pode enviá-la ao cliente no
-- WhatsApp. O arquivo mora em `whatsapp-media/{org}/materiais/{uuid}.{ext}` —
-- fora das pastas por conversa que o redact da LGPD apaga, porque é ativo da
-- EMPRESA e não do contato.
--
-- Não há DDL: a coluna é de vocabulário ABERTO desde a 0181 (sem CHECK,
-- precedente da 0127), e o tipo novo entra só pelo TypeScript
-- (`lib/ai/rag/tipos-de-fonte.ts`). O que muda aqui é o COMENTÁRIO da coluna,
-- que a 0181 escreveu listando os quatro tipos de então — e uma lista no
-- comentário é uma afirmação de estado que envelhece a cada tipo novo. O texto
-- novo aponta para a fonte da verdade em vez de copiá-la.
--
-- Idempotente (comment on é sobrescrita).
-- ============================================================================

comment on column public.ai_knowledge_sources.source_type is
  'Vocabulário ABERTO (sem CHECK, precedente da 0127). Os tipos aceitos, o que a tela oferece e como cada um é ingerido vivem em lib/ai/rag/tipos-de-fonte.ts — é lá que se confere, não aqui. Valor sem caminho de ingestão falha no indexador com motivo escrito na própria fonte.';
