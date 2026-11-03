-- 0251 · Agente de suporte: limite diário atômico, policy presa à organização,
-- retenção do histórico e anonimização LGPD alcançando o histórico.
--
-- Forward-fix da 0250 (que não é editada). Quatro peças:
--
-- 1. `agente_uso_diario` + `fn_agente_reservar_pergunta`: o limite de perguntas
--    por dia deixa de ser "conta e depois grava" — duas requisições juntas viam
--    a mesma contagem e as duas passavam. Agora é UM `insert ... on conflict do
--    update ... where perguntas < limite returning`: a linha do dia fica travada
--    pela própria upsert, e quem chega no limite não recebe linha nenhuma. O
--    contador também é independente do histórico: apagar o histórico ("limpar
--    minha conversa") não devolve perguntas ao dia.
--
-- 2. A leitura do histórico exige, além de ser o dono, ainda ser membro da
--    organização: quem saiu da empresa não segue lendo o que perguntou lá.
--
-- 3. `fn_expurgar_historico_do_agente`: o histórico é ajuda de uso, não
--    registro — 90 dias por padrão, piso de 30. Chamada em lotes pelo cron
--    `data-retention`.
--
-- 4. Trigger em `contacts`: quando um contato é anonimizado (LGPD), o nome, o
--    nome de exibição e o e-mail que ele tinha somem também do histórico da
--    assistente daquela organização — a resposta gravada pode ter citado o
--    cliente pelo nome. Trigger, e não mais uma linha dentro de
--    `fn_lgpd_cascade_redact_contact`, porque assim TODO caminho de
--    anonimização é alcançado (pedido LGPD aprovado, botão "anonimizar",
--    webhook de redact da Nuvemshop) sem ninguém precisar lembrar desta tabela.

-- ---- 1. contador diário ----------------------------------------------------

create table if not exists public.agente_uso_diario (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia date not null,
  perguntas integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, dia),
  constraint agente_uso_diario_perguntas_check check (perguntas >= 0)
);

alter table public.agente_uso_diario enable row level security;
-- Sem policy: só o servidor lê e escreve. O limite é da PESSOA (em qualquer
-- organização), por isso não há organization_id aqui.
revoke all on public.agente_uso_diario from anon, authenticated;
grant all on public.agente_uso_diario to service_role;

comment on table public.agente_uso_diario is
  'Agente de suporte (0251): perguntas por pessoa por dia (fuso de São Paulo). Reservadas por fn_agente_reservar_pergunta.';

-- Semeia o dia corrente a partir do que a 0250 já gravou, para a troca de
-- regra não devolver perguntas a quem já usou hoje.
insert into public.agente_uso_diario (user_id, dia, perguntas)
select m.user_id, (m.created_at at time zone 'America/Sao_Paulo')::date, count(*)::int
  from public.agente_mensagens m
 where m.role = 'user'
   and m.created_at > now() - interval '2 days'
 group by 1, 2
on conflict (user_id, dia) do nothing;

create or replace function public.fn_agente_reservar_pergunta(
  p_user_id uuid,
  p_dia date,
  p_limite integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usadas integer;
begin
  if p_user_id is null or p_dia is null or coalesce(p_limite, 0) < 1 then
    return null;
  end if;

  insert into public.agente_uso_diario as u (user_id, dia, perguntas)
  values (p_user_id, p_dia, 1)
  on conflict (user_id, dia) do update
     set perguntas = u.perguntas + 1,
         atualizado_em = now()
   where u.perguntas < p_limite
  returning u.perguntas into v_usadas;

  -- null = o dia já estava no limite; nada foi reservado.
  return v_usadas;
end;
$$;

revoke execute on function public.fn_agente_reservar_pergunta(uuid, date, integer) from public, anon, authenticated;
grant  execute on function public.fn_agente_reservar_pergunta(uuid, date, integer) to service_role;

-- ---- 2. leitura presa à organização ----------------------------------------

drop policy if exists agente_conversas_select on public.agente_conversas;
create policy agente_conversas_select on public.agente_conversas
  for select using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

drop policy if exists agente_mensagens_select on public.agente_mensagens;
create policy agente_mensagens_select on public.agente_mensagens
  for select using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

-- ---- 3. retenção -----------------------------------------------------------

create index if not exists agente_mensagens_created_idx
  on public.agente_mensagens (created_at);

create or replace function public.fn_expurgar_historico_do_agente(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- 90 dias de histórico de ajuda; piso de 30 para o knob nunca virar
  -- apagador da conversa de ontem.
  v_dias int := greatest(coalesce(p_retencao_dias, 90), 30);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_mensagens int;
  v_conversas int;
begin
  with vencidas as (
    select m.id
      from public.agente_mensagens m
     where m.created_at < now() - make_interval(days => v_dias)
     order by m.created_at
     limit v_limite
  )
  delete from public.agente_mensagens m
   using vencidas v
   where m.id = v.id;
  get diagnostics v_mensagens = row_count;

  -- Conversa velha que ficou vazia (todas as mensagens venceram) sai junto.
  with vazias as (
    select c.id
      from public.agente_conversas c
     where c.created_at < now() - make_interval(days => v_dias)
       and not exists (select 1 from public.agente_mensagens m where m.conversa_id = c.id)
     order by c.created_at
     limit v_limite
  )
  delete from public.agente_conversas c
   using vazias v
   where c.id = v.id;
  get diagnostics v_conversas = row_count;

  -- O contador só importa no dia dele; uma semana de folga para diagnóstico.
  delete from public.agente_uso_diario where dia < current_date - 7;

  return v_mensagens + v_conversas;
end;
$$;

revoke execute on function public.fn_expurgar_historico_do_agente(int, int) from public, anon, authenticated;
grant  execute on function public.fn_expurgar_historico_do_agente(int, int) to service_role;

-- ---- 4. anonimização LGPD alcança o histórico ------------------------------

create or replace function public.fn_agente_redigir_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trecho text;
  v_padrao text;
begin
  foreach v_trecho in array array[old.name, old.display_name, old.email] loop
    -- Menos de 3 letras casaria pedaço de qualquer palavra. Acima disso, apagar
    -- a mais é aceitável: é histórico de ajuda, não registro.
    continue when v_trecho is null or length(btrim(v_trecho)) < 3;
    v_trecho := btrim(v_trecho);
    -- Metacaracteres de regex escapados: o nome é dado, não padrão.
    v_padrao := regexp_replace(v_trecho, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g');
    update public.agente_mensagens m
       set content = regexp_replace(m.content, v_padrao, 'Cliente anonimizado', 'gi')
     where m.organization_id = new.organization_id
       and m.content ~* v_padrao;
  end loop;
  return new;
end;
$$;

revoke execute on function public.fn_agente_redigir_contato_anonimizado() from public, anon, authenticated;

drop trigger if exists trg_contacts_agente_redigir on public.contacts;
create trigger trg_contacts_agente_redigir
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_agente_redigir_contato_anonimizado();

notify pgrst, 'reload schema';
