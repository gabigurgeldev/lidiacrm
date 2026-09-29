-- 0218 — mensagem de aniversário automática.
--
-- ═══ O que o recurso faz ═══
--
-- Com a chave ligada em Configurações › Aniversários, um cron de hora em hora
-- (`app/api/v1/cron/aniversarios`) confere cada organização: quando a hora
-- local da empresa chega à hora escolhida, os contatos que fazem aniversário
-- naquele dia viram UM disparo em massa ("Aniversariantes de DD/MM") na conexão
-- escolhida. O envio em si é o do disparo — ritmo anti-banimento, janela,
-- opt-out, reenvio e tela de resultados, sem uma segunda máquina de envio.
--
-- ═══ aniversario_envios ═══
--
-- Uma linha por organização por DIA LOCAL, com `UNIQUE(organization_id,
-- data_local)`. É a trava de idempotência: o cron roda de hora em hora e é
-- reentregável, e a segunda rodada do mesmo dia NÃO pode criar outro disparo
-- (a pessoa receberia os parabéns duas vezes). O motor reserva o dia com um
-- INSERT antes de montar o disparo; conflito = já feito. Guarda também o
-- `bulk_send_id` do disparo do dia — é por ele que a tela lista os envios.
--
-- Sem dado pessoal: nenhuma coluna identifica contato, então a linha fica fora
-- da cascata de LGPD.
--
-- ⚠️ O cliente NÃO escreve aqui (policy só de leitura + revoke): quem escreve é
-- o cron, com service role.
--
-- ═══ fn_aniversariantes_do_dia ═══
--
-- PostgREST não filtra por mês/dia de uma coluna `date`. A função devolve os
-- contatos da organização cuja data de nascimento cai num dos 'MM-DD' pedidos
-- (o motor pede '02-28' e '02-29' juntos em ano não bissexto). Recorte mínimo
-- aqui (telefone, não anonimizado, não mesclado); quem decide opt-out e
-- bloqueio é `checarContato`, na montagem do disparo — uma regra só.
-- `security invoker` e EXECUTE só para service_role (revogado de public e anon,
-- regra 9 da doutrina de migrations).

create table if not exists public.aniversario_envios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_local date not null,
  bulk_send_id uuid references public.bulk_sends(id) on delete set null,
  total integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists aniversario_envios_org_dia_unique
  on public.aniversario_envios (organization_id, data_local);

alter table public.aniversario_envios enable row level security;

drop policy if exists aniversario_envios_select on public.aniversario_envios;
create policy aniversario_envios_select on public.aniversario_envios
  for select using (organization_id in (select fn_user_org_ids()));

revoke insert, update, delete, truncate on public.aniversario_envios from anon, authenticated;

comment on table public.aniversario_envios is
  'Um registro por organização por dia local em que a mensagem de aniversário rodou; UNIQUE(organization_id, data_local) impede o segundo disparo no mesmo dia. Escrita só pelo cron (service role).';

create or replace function public.fn_aniversariantes_do_dia(p_org uuid, p_mmdd text[])
returns table (contact_id uuid, nome text, birthdate date)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, coalesce(nullif(c.display_name, ''), c.name), c.birthdate
    from public.contacts c
   where c.organization_id = p_org
     and c.birthdate is not null
     and to_char(c.birthdate, 'MM-DD') = any (p_mmdd)
     and c.phone_number is not null
     and coalesce(c.is_anonymized, false) = false
     and c.is_merged_into is null
   order by c.name
$$;

revoke execute on function public.fn_aniversariantes_do_dia(uuid, text[]) from public, anon, authenticated;
grant execute on function public.fn_aniversariantes_do_dia(uuid, text[]) to service_role;
