-- 0238 — Coordenador: a decisão que MANTÉM quem conduz entra no diário.
--
-- O decisor consulta o modelo a cada mensagem, mas `coord_transicoes` só
-- ganhava linha quando havia TROCA. Quando o modelo escolhia quem já conduzia
-- (o caso mais comum numa conversa em andamento), a decisão sumia: nem modelo,
-- nem escolha, nem confiança, nem o erro quando ele falhava e o coordenador
-- caía na regra de segurança mantendo o dono. A aba Atividade ficava congelada
-- na última troca — medido em produção (2026-10-12): uma única linha
-- "o modelo de decisão falhou" de dois dias antes, enquanto `llm_calls` tinha
-- toda consulta seguinte `ok`. Para quem opera, o modelo parecia quebrado.
--
-- Status novo `mantida`: decisão em que o modelo foi consultado e a conversa
-- seguiu com o mesmo dono. Os limites de transferência não a contam
-- (`lib/coordenador/limites.ts` só conta `aplicada`).
--
-- Idempotente: drop constraint if exists + add.

alter table public.coord_transicoes drop constraint if exists coord_transicoes_status_check;
alter table public.coord_transicoes add constraint coord_transicoes_status_check
  check (status in ('aplicada', 'recusada', 'obsoleta', 'falhou', 'shadow', 'mantida'));
