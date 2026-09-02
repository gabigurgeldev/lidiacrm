-- 0206 — quarto canal (intermediário de conta) + a MODALIDADE de uma sessão.
--
-- ═══ O que entra, e por quê são duas coisas no mesmo arquivo ═══
--
-- 1. O vocabulário do quarto provider (`stevo_instance_id`, `stevo_token_encrypted`),
--    nos mesmos moldes da 0131: coluna própria porque o identificador é a
--    INSTÂNCIA no painel do intermediário — id dele, não o `phone_number_id` da
--    Meta nem a conta do outro intermediário. Espaços de identificador
--    diferentes; reusar coluna faria o nome mentir sobre metade das linhas.
--
-- 2. `provider_mode`, que é a novidade estrutural: até aqui a MODALIDADE de um
--    canal era dedutível do provider (um pareia por QR, os outros são oficiais).
--    Este intermediário quebra isso — a MESMA conta hospeda instância oficial
--    (WABA da Meta, janela de 24h, template aprovado) e número ligado por QR
--    (texto livre, risco de banimento). São regras de envio OPOSTAS sob um nome
--    só, e sem a coluna o sistema teria de escolher uma e errar na metade dos
--    canais.
--
--    As duas andam juntas porque separá-las criaria um estado intermediário em
--    que o provider existe e sua modalidade não: toda linha nasceria sem regra
--    de envio conhecida, e o caminho conservador (tratar como oficial) travaria
--    envio livre em número por QR.
--
-- ═══ Por que `provider_mode` é NULLABLE e sem default ═══
--
-- Porque `null` significa algo: "este provider tem modalidade única, pergunte a
-- ele". Um default ('oficial', digamos) marcaria toda linha existente de WAHA
-- como oficial — e o WAHA é justamente o que não é. Nullable também é o que faz
-- esta migration não tocar em nenhuma linha existente.
--
-- ═══ Idempotente e auto-curativa (doutrina de migrations) ═══
--
-- Colunas com `if not exists`; os dois CHECKs de provider são RECRIADOS
-- (drop + add) porque precisam MUDAR — um clone com a versão de três providers
-- ficaria com a constraint antiga e recusaria a sessão nova em silêncio, com o
-- `update.sh` passando verde.
--
-- Nada a deduplicar antes das constraints: toda linha pré-existente tem provider
-- entre os três antigos e já satisfaz o ramo correspondente, e
-- `stevo_instance_id` nasce nulo em todas.

alter table public.channel_sessions
  add column if not exists stevo_instance_id text;

alter table public.channel_sessions
  add column if not exists stevo_token_encrypted bytea;

alter table public.channel_sessions
  add column if not exists provider_mode text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'stevo'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider = 'zernio'     and zernio_account_id    is not null) or
    (provider = 'stevo'      and stevo_instance_id    is not null)
  );

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_mode_check;

-- Vocabulário FECHADO, e com CHECK: ao contrário de `crm_lead_activities.type`,
-- aqui não há valor legado em clone nenhum (a coluna nasce agora), então a
-- constraint não quebra `update.sh`. E o valor decide REGRA DE ENVIO — um valor
-- desconhecido gravado por engano viraria "não sei" silencioso na tela.
alter table public.channel_sessions
  add constraint channel_sessions_provider_mode_check
  check (provider_mode is null or provider_mode = any (array['oficial'::text, 'qr'::text]));

-- Dedup ANTES do índice único, como manda a doutrina: um clone que tenha rodado
-- uma versão de desenvolvimento pode ter duas linhas ativas com a mesma
-- instância, e o `create unique index` quebraria o `update.sh` dele. Mantém a
-- mais antiga e desloca as outras para um identificador de conflito — nunca
-- apaga linha, que é âncora de FK de conversas e mensagens.
update public.channel_sessions c
   set stevo_instance_id = c.stevo_instance_id || '-conflito-' || c.id::text
  from (
    select id,
           row_number() over (partition by stevo_instance_id order by created_at, id) as n
      from public.channel_sessions
     where stevo_instance_id is not null
       and archived_at is null
  ) d
 where d.id = c.id
   and d.n > 1;

create unique index if not exists channel_sessions_stevo_instance_id_ativo_unique
  on public.channel_sessions (stevo_instance_id)
  where archived_at is null and stevo_instance_id is not null;

comment on column public.channel_sessions.stevo_instance_id is
  'Identificador da INSTÂNCIA no painel do intermediário de conta — id dele, não o phone_number_id da Meta. É o que endereça envio, webhook e saúde. Espelhado em lib/channels/session-ref.ts.';

comment on column public.channel_sessions.provider_mode is
  'A modalidade da sessão quando o provider hospeda mais de uma: oficial (janela de 24h, template aprovado) ou qr (texto livre, risco de banimento). NULL = o provider tem modalidade única e ela sai da identidade dele. Espelhado em lib/channels/tipo-de-conexao.ts.';
