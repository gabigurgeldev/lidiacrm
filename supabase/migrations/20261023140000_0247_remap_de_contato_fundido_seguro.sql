-- 0247 — remapear conversas de contato fundido sem estourar o índice 1:1.
--
-- O baseline repete, em três blocos de deduplicação de contatos (o da 0027 e os
-- dois do nono dígito), o mesmo passo:
--
--   update conversations set contact_id = c.is_merged_into from contacts c
--    where t.contact_id = c.id and c.is_merged_into is not null;
--
-- Ele move TODA conversa de contato fundido para o contato de destino, sem olhar
-- se o destino já tem conversa 1:1 naquele número. Quando tem, o UPDATE viola
-- `uniq_conversations_1to1_per_contact_session` — e, como o `migrate` aplica o
-- baseline numa transação só, a violação desfaz o baseline INTEIRO.
--
-- Foi o que aconteceu em produção: dois contatos fundidos em 2026-10-15 deixaram
-- duas conversas cujo destino já tinha conversa no mesmo número. Dali em diante
-- toda atualização falhou em silêncio (o app sobe com o banco como está), e as
-- migrations 0244–0246 nunca chegaram.
--
-- O conserto: mover só quando o destino ainda não tem conversa 1:1 naquele
-- número e, entre vários perdedores para o mesmo destino e número, só o mais
-- antigo. As que sobram ficam no contato fundido, exatamente como já estavam —
-- nada é apagado nem fundido às cegas. Idempotente.
--
-- O mesmo texto substitui os três passos no `supabase/baseline.sql`.

with movivel as (
  select t.id, c.is_merged_into as destino,
         row_number() over (
           partition by t.organization_id, c.is_merged_into, t.channel_session_id, t.is_group
           order by t.created_at, t.id) as ordem
    from public.conversations t
    join public.contacts c on c.id = t.contact_id
   where c.is_merged_into is not null
)
update public.conversations t
   set contact_id = m.destino
  from movivel m
 where t.id = m.id
   and (t.is_group
        or (m.ordem = 1
            and not exists (
              select 1 from public.conversations w
               where w.organization_id = t.organization_id
                 and w.contact_id = m.destino
                 and w.channel_session_id = t.channel_session_id
                 and w.is_group = false)));
