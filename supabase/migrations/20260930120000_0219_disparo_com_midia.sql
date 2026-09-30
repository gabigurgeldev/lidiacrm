-- 0219 — Disparo em massa com imagem ou vídeo junto do texto.
--
-- Pelo número de QR code (modo texto livre), o disparo pode levar UMA imagem
-- ou UM vídeo; o texto vira a legenda. O arquivo é UM por disparo, em
-- `whatsapp-media/<org>/disparos/…`, e todas as mensagens da campanha apontam
-- para ele (`messages.metadata.midia_do_disparo`), em vez de uma cópia por
-- destinatário: um vídeo de 10 MB para 300 pessoas seriam 3 GB no bucket de
-- 1 GB do self-host.
--
-- Mídia só em texto livre: no modo modelo aprovado, a imagem é do cabeçalho do
-- modelo e já tem caminho próprio (`template_values`).
--
-- Idempotente. Sem backfill: disparos antigos não têm mídia (colunas nulas).

alter table public.bulk_sends add column if not exists media_storage_path text;
alter table public.bulk_sends add column if not exists media_mime text;
alter table public.bulk_sends add column if not exists media_kind text;

alter table public.bulk_sends drop constraint if exists bulk_sends_midia_check;
alter table public.bulk_sends add constraint bulk_sends_midia_check
  check (
    (media_storage_path is null and media_kind is null and media_mime is null)
    or (
      media_storage_path is not null
      and media_mime is not null
      and media_kind in ('image', 'video')
      and mode = 'freeform'
    )
  );
