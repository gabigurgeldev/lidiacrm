-- 0204 · Disparo em massa — falar com uma lista sem queimar o número.
--
-- ─── O que não existia ───────────────────────────────────────────────────────
-- O CRM sabia mandar mensagem para UMA pessoa. Quem instala numa VPS e tem 400
-- clientes na planilha não tinha caminho: abrir 400 conversas à mão, ou usar
-- outra ferramenta. E o `CLAUDE.md` prometia "Campanha 1 msg/5s" desde sempre —
-- prosa órfã, sem uma linha de código atrás dela.
--
-- ─── Por que DUAS tabelas, e não uma com `contact_ids uuid[]` ────────────────
-- Porque o desfecho é POR PESSOA e o operador precisa vê-lo. Um array não tem
-- onde guardar "esta falhou por X, esta foi pulada porque pediu para parar" —
-- e é exatamente essa lista que responde à pergunta "deu certo?". Um array
-- também não tem índice único, e é o único `(bulk_send_id, contact_id)` que
-- impede a mesma pessoa de receber duas vezes na mesma campanha.
--
-- ─── Por que `interval_ms` é coluna, sendo que o piso vive noutro lugar ──────
-- Não duplica o piso: guarda a VONTADE do operador acima dele. O piso continua
-- em `channel_knobs.throttle_ms` (por número) e em `capabilities.minIntervalMs`
-- (por canal), e quem resolve os três é `lib/bulk-send/ritmo.ts`, com a regra
-- "pode ir mais devagar, nunca mais rápido". Guardar o piso aqui criaria uma
-- segunda régua que envelheceria em silêncio quando a de lá mudasse.
--
-- ─── Por que `pause_reason` existe ──────────────────────────────────────────
-- Porque sem ela o motor faria `return` mudo quando o pacing vetasse, e a tela
-- diria "parado" sem dizer por quê. O invariante 6 do sistema vivo proíbe
-- exatamente isso: toda configuração tem superfície, e o caminho de falha é
-- visível. O código do veto vem de `decidePacing()` — `outside_window`,
-- `warmup_cap`, `daily_cap` — mais `operador` para a pausa manual.
--
-- ─── Por que `channel_session_id` é ON DELETE RESTRICT ──────────────────────
-- Apagar a conexão que um disparo em voo usa deixaria o motor sem por onde
-- enviar, no meio da fila. Mesma escolha que `conversations` já faz.
--
-- ─── Por que NÃO há coluna de corpo por destinatário ────────────────────────
-- O corpo, o `external_id` e o desfecho do transporte já moram em `messages`,
-- que é onde o resto do produto os procura. Aqui fica `message_id`, ponteiro —
-- e a conversa aparece no Inbox como qualquer outra. Duplicar o texto faria a
-- tela do disparo e a do Inbox divergirem no dia em que uma fosse corrigida.
--
-- ─── Por que `claimed_until` separado de `next_send_at` ─────────────────────
-- São perguntas diferentes: `next_send_at` é QUANDO a próxima mensagem pode
-- sair (relógio, do produto); `claimed_until` é ATÉ QUANDO este tique é dono da
-- linha (lease, do motor). Colapsá-las faria um tique lento parecer um disparo
-- adiado, e o operador leria "vai sair às 14h05" para uma campanha que está
-- rodando agora.
--
-- Aditiva, idempotente e auto-curativa: duas tabelas novas com `if not exists`,
-- toda constraint com `drop ... if exists` antes do `add`, e a lista de
-- `agent_inbox_items.kind` reconstruída em UM bloco só (issue #159) com o
-- vocabulário INTEIRO vigente mais o valor novo — nunca um subconjunto.

-- ───────────────────────────── bulk_sends ────────────────────────────────────

create table if not exists public.bulk_sends (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  status              text not null default 'draft',
  channel_session_id  uuid not null references public.channel_sessions(id) on delete restrict,
  -- Cópia FIXADA do provider no instante da criação, mesmo raciocínio de
  -- `flow_versions.trigger_config` (0203). Referenciar `channel_sessions.provider`
  -- deixaria uma campanha montada para canal oficial (template) trocar em
  -- silêncio para QR se o número fosse re-pareado no meio da fila. Com a cópia,
  -- o motor compara com a sessão viva e FALHA ALTO em vez de mandar a coisa
  -- errada para o resto da lista.
  provider            text not null,
  mode                text not null,
  -- Modo livre: o texto que sai igual para todo mundo.
  body                text,
  -- Modo template: a definição aprovada da plataforma e os valores das variáveis.
  template_name       text,
  template_language   text,
  template_values     jsonb not null default '{}'::jsonb,
  -- O "tempo de disparo" que o operador escolheu. Piso aplicado no motor.
  interval_ms         integer not null default 5000,
  -- null = começa assim que der start.
  scheduled_for       timestamptz,
  -- Relógio do produto: quando a próxima mensagem pode sair.
  next_send_at        timestamptz,
  -- Lease do motor: até quando este tique é dono da linha.
  claimed_until       timestamptz,
  -- outside_window | warmup_cap | daily_cap | operador
  pause_reason        text,
  -- A frase em pt-BR que o pacing produziu, para a tela não reescrever a régua.
  pause_detail        text,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $bulk_sends_checks$ begin
  alter table public.bulk_sends drop constraint if exists bulk_sends_status_check;
  alter table public.bulk_sends add constraint bulk_sends_status_check
    check (status in ('draft','scheduled','running','paused','done','cancelled'));

  alter table public.bulk_sends drop constraint if exists bulk_sends_mode_check;
  alter table public.bulk_sends add constraint bulk_sends_mode_check
    check (mode in ('freeform','template'));

  alter table public.bulk_sends drop constraint if exists bulk_sends_pause_reason_check;
  alter table public.bulk_sends add constraint bulk_sends_pause_reason_check
    check (pause_reason is null
           or pause_reason in ('outside_window','warmup_cap','daily_cap','operador'));

  -- Coerência modo↔conteúdo no SCHEMA, não na prosa: um disparo em modo
  -- template SEM definição sairia como texto vazio pelo canal oficial, e um em
  -- modo livre sem corpo enviaria string vazia para a lista inteira.
  alter table public.bulk_sends drop constraint if exists bulk_sends_modo_x_conteudo_check;
  alter table public.bulk_sends add constraint bulk_sends_modo_x_conteudo_check
    check (
      (mode = 'template' and template_name is not null and template_language is not null)
      or (mode = 'freeform' and body is not null and length(btrim(body)) > 0)
    );

  -- Mesma régua de KNOB_BOUNDS (lib/agent-engine/pacing/defaults.ts): a tela e o
  -- banco recusam o mesmo intervalo. NÃO é o piso anti-ban — quem decide o ritmo
  -- real é decidePacing, e este valor só COMPÕE com ele por Math.max. Existe
  -- para zero e negativo não chegarem ao motor, e para 10min ser o teto dos dois
  -- lados: acima disso é erro de digitação, não escolha.
  alter table public.bulk_sends drop constraint if exists bulk_sends_interval_check;
  alter table public.bulk_sends add constraint bulk_sends_interval_check
    check (interval_ms between 1000 and 600000);
end $bulk_sends_checks$;

create index if not exists idx_bulk_sends_due
  on public.bulk_sends (next_send_at)
  where status = 'running';

create index if not exists idx_bulk_sends_agendados
  on public.bulk_sends (scheduled_for)
  where status = 'scheduled';

create index if not exists idx_bulk_sends_listagem
  on public.bulk_sends (organization_id, created_at desc);

-- Serve ao `not exists` do claim: "este número já tem outra campanha com lease
-- vivo?". Sem ele a pergunta vira varredura da tabela a cada tique.
create index if not exists idx_bulk_sends_por_numero
  on public.bulk_sends (channel_session_id, claimed_until)
  where status = 'running';

-- Sem CHECK de vocabulário em `provider`, e é deliberado: a coluna é uma CÓPIA
-- congelada de `channel_sessions.provider`, que já tem
-- `channel_sessions_provider_check`. Repetir a lista aqui criaria um TERCEIRO
-- lugar a editar quando um canal novo entrar (o quarto contando
-- `lib/channels/capabilities.ts`), e o esquecido reprovaria o `update.sh` de um
-- clone que já tem a linha nova. O valor só chega aqui vindo de uma sessão que
-- passou pelo CHECK de lá, e o motor ainda o reconfere contra a sessão viva.
comment on column public.bulk_sends.provider is
  'Copia congelada de channel_sessions.provider no instante da criacao. Sem CHECK proprio de proposito: a lista canonica e a de channel_sessions_provider_check.';

-- ─────────────────────── bulk_send_recipients ────────────────────────────────

create table if not exists public.bulk_send_recipients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  bulk_send_id     uuid not null references public.bulk_sends(id) on delete cascade,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  -- `sending` não é decoração: é o que torna a retomada pós-restart segura.
  -- `sendMessageHandler` NÃO lança quando o envio falha — ele marca a linha de
  -- `messages` e devolve normalmente. Entre marcar `sending` e ter o desfecho há
  -- uma chamada de rede; um contêiner que morre no meio deixa a linha aqui. A
  -- varredura do tique seguinte só a devolve para `pending` quando `message_id`
  -- é nulo (nada chegou a ser criado). Com `message_id`, ela vai LER o estado
  -- daquela mensagem e adotar o desfecho — nunca reenviar.
  status           text not null default 'pending',
  -- Por que NÃO recebeu. Resolvido na montagem da lista (o operador vê o recorte
  -- antes de confirmar) ou no envio, quando a pessoa bloqueou no meio da campanha.
  skip_reason      text,
  -- Mensagem crua do transporte quando `failed`. Não é `skip_reason`: pulado é
  -- decisão nossa e não se tenta de novo; falha é do mundo e se tenta.
  error            text,
  message_id       uuid references public.messages(id) on delete set null,
  attempts         smallint not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

do $bulk_recipients_checks$ begin
  alter table public.bulk_send_recipients drop constraint if exists bulk_send_recipients_status_check;
  alter table public.bulk_send_recipients add constraint bulk_send_recipients_status_check
    check (status in ('pending','sending','sent','failed','skipped'));

  -- O vocabulário é EXATAMENTE o de `MotivoDeBloqueio`
  -- (`lib/automation/guarda-do-contato.ts`), menos `no_contact` — que nunca
  -- chega a virar linha, porque a FK exige o contato para a linha existir.
  -- Igualdade deliberada: uma camada de tradução entre o veredito da guarda e o
  -- valor gravado seria mais um lugar para divergir, e o teste
  -- `bulk-send-frases.test.ts` varre este CHECK cobrando frase para cada valor.
  alter table public.bulk_send_recipients drop constraint if exists bulk_send_recipients_skip_reason_check;
  alter table public.bulk_send_recipients add constraint bulk_send_recipients_skip_reason_check
    check (skip_reason is null
           or skip_reason in ('contact_blocked','consent_declined','no_phone','contact_anonymized','contact_merged'));

  -- `skipped` SEM motivo é o silêncio que esta feature existe para não ter: a
  -- tela não teria o que dizer ao operador, e o invariante 4 (nenhuma demanda
  -- sem próximo passo) morreria numa linha em branco.
  alter table public.bulk_send_recipients drop constraint if exists bulk_send_recipients_skip_tem_motivo;
  alter table public.bulk_send_recipients add constraint bulk_send_recipients_skip_tem_motivo
    check ((status = 'skipped') = (skip_reason is not null));
end $bulk_recipients_checks$;

-- A trava de não-duplicação: a mesma pessoa não entra duas vezes na mesma
-- campanha, nem por planilha repetida, nem por corrida no motor.
create unique index if not exists uniq_bulk_send_recipient
  on public.bulk_send_recipients (bulk_send_id, contact_id);

-- A fila que o motor consome: o próximo `pending` deste disparo.
create index if not exists idx_bulk_send_recipients_fila
  on public.bulk_send_recipients (bulk_send_id, id)
  where status = 'pending';

-- A tela de resultado agrupa por desfecho — e é o mesmo índice que serve à
-- LISTA de disparos: um único `group by (bulk_send_id, status)` para a página
-- inteira, em vez de um `count` por linha. É por isso que não há contador
-- materializado em `bulk_sends`: ele teria DOIS escritores (a rota, que grava
-- os pulados na montagem, e o motor, que grava os enviados) e divergiria.
create index if not exists idx_bulk_send_recipients_desfecho
  on public.bulk_send_recipients (bulk_send_id, status);

-- A varredura de `sending` órfão do tique seguinte (contêiner que morreu no
-- meio de um envio). `updated_at` não existe aqui de propósito: `created_at` +
-- `sent_at` bastam, e o que decide a adoção é `message_id`, não o relógio.
create index if not exists idx_bulk_send_recipients_em_voo
  on public.bulk_send_recipients (bulk_send_id)
  where status = 'sending';

-- ───────────────────────────────── RLS ───────────────────────────────────────

alter table public.bulk_sends           enable row level security;
alter table public.bulk_send_recipients enable row level security;

drop policy if exists tenant_isolation_bulk_sends_all on public.bulk_sends;
create policy tenant_isolation_bulk_sends_all on public.bulk_sends
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_bulk_send_recipients_all on public.bulk_send_recipients;
create policy tenant_isolation_bulk_send_recipients_all on public.bulk_send_recipients
  for all
  using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

revoke all on public.bulk_sends           from anon, public;
revoke all on public.bulk_send_recipients from anon, public;

grant select, insert, update, delete on public.bulk_sends           to authenticated;
grant select, insert, update, delete on public.bulk_send_recipients to authenticated;

-- ───────────────────────────── o claim ───────────────────────────────────────
--
-- Mesmo desenho de `fn_claim_due_flow_executions` (0203), inclusive o rodízio
-- por organização — uma org com dez campanhas não pode monopolizar o lote e
-- deixar a campanha única de outra parada. As duas armadilhas herdadas:
--
--   1. `for update skip locked` NÃO convive com window function na mesma query,
--      por isso a CTE `travados` é separada.
--   2. `skip locked` sozinho NÃO impede duas conexões de reclamarem a mesma
--      linha: as duas materializam os candidatos ANTES de qualquer lock, e a
--      segunda, ao ganhar o lock, reavalia apenas o WHERE do UPDATE (READ
--      COMMITTED). Por isso a condição de lease está REPETIDA no UPDATE.
--
-- Aqui o lease importa mais que no flow engine: entre reclamar e enviar há uma
-- chamada de rede ao WhatsApp. Dois tiques donos da mesma campanha mandariam a
-- mesma mensagem duas vezes para a mesma pessoa — e envio em dobro é pior que
-- não-envio (mesma doutrina do `recover-stuck-messages`).
--
-- ─── A cláusula que as funções irmãs NÃO têm, e por que ela existe ───────────
--
-- O throttle anti-ban é POR NÚMERO (`channel_knobs` é chaveado em
-- `channel_session_id`), mas o claim do follow-up e o do flow engine fazem
-- rodízio por ORGANIZAÇÃO. Copiá-los sem mais nada deixaria duas campanhas do
-- MESMO número rodando ao mesmo tempo — cada uma respeitando 1 msg/1,2s por si,
-- e o número real saindo a 2 msg/1,2s. O anti-ban ficaria verde em toda medição
-- individual e o cliente seria banido mesmo assim.
--
-- São duas travas, e as duas são necessárias:
--   * `not exists (...)` — não reclama campanha cujo número já tem OUTRA com
--     lease vivo (concorrência entre tiques distintos);
--   * `distinct on (channel_session_id)` — o MESMO lote nunca entrega duas do
--     mesmo número (concorrência dentro de um tique).

create or replace function public.fn_claim_due_bulk_sends(p_limit int, p_lease_seconds int)
returns setof public.bulk_sends
language sql
security definer
set search_path = public
as $claim$
  with orgs as (
    select distinct organization_id
      from public.bulk_sends
     where status = 'running'
       and next_send_at <= now()
  ),
  fila as (
    select f.id, f.channel_session_id, f.next_send_at, f.posicao_na_org
      from orgs
      cross join lateral (
        select d.id,
               d.channel_session_id,
               d.next_send_at,
               row_number() over (order by d.next_send_at) as posicao_na_org
          from public.bulk_sends d
         where d.organization_id = orgs.organization_id
           and d.status = 'running'
           and d.next_send_at <= now()
           and (d.claimed_until is null or d.claimed_until < now())
           -- O número já está ocupado por outra campanha viva — ver o cabeçalho.
           and not exists (
             select 1
               from public.bulk_sends o
              where o.channel_session_id = d.channel_session_id
                and o.id <> d.id
                and o.status = 'running'
                and o.claimed_until is not null
                and o.claimed_until > now()
           )
         order by d.next_send_at
         limit p_limit
      ) f
  ),
  -- Uma por número dentro do lote. `distinct on` exige que o `order by` comece
  -- pela mesma expressão; a preferência real (rodízio, depois quem esperou mais)
  -- vem depois dela e decide QUAL das do número entra.
  um_por_numero as (
    select distinct on (channel_session_id) id, next_send_at, posicao_na_org
      from fila
     order by channel_session_id, posicao_na_org, next_send_at
  ),
  escolhidos as (
    select id from um_por_numero order by posicao_na_org, next_send_at limit p_limit
  ),
  travados as (
    select b.id from public.bulk_sends b
     where b.id in (select id from escolhidos)
     for update skip locked
  )
  update public.bulk_sends b
     set claimed_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where b.id in (select id from travados)
     -- REPETIDA de propósito — ver o item 2 do cabeçalho acima.
     and (b.claimed_until is null or b.claimed_until < now())
  returning b.*;
$claim$;

-- Função em `public` nasce EXPOSTA por DUAS origens distintas, e tratar só uma
-- deixa a RPC alcançável pela anon key: (A) o `alter default privileges ... to anon`
-- do baseline, que `revoke from public` não remove; (B) o grant a PUBLIC que o
-- Postgres dá a toda função ao criá-la, que `revoke from anon` não remove.
revoke execute on function public.fn_claim_due_bulk_sends(int, int) from public, anon, authenticated;
grant execute on function public.fn_claim_due_bulk_sends(int, int) to service_role;

-- ──────────────── agent_inbox_items.kind ganha 'disparo_travado' ─────────────
--
-- O laço de retorno do disparo (invariante 7). Campanha que o pacing vetou por
-- warm-up ou cap diário, ou que está falhando em série, fica parada com a razão
-- na própria linha — mas quem não abrir a tela não fica sabendo. Este kind é o
-- que leva o defeito à Central de avisos, onde o operador já olha.
--
-- Bloco ÚNICO com o vocabulário INTEIRO vigente (issue #159): reconstruir a
-- constraint com um subconjunto foi o que a 0129 fez, apagando três valores e
-- fazendo INSERTs de aviso violarem a constraint em silêncio num clone que
-- aplica migrations em ordem. `tests/unit/kind-check-migration-x-baseline.test.ts`
-- compara esta lista com a do baseline, valor a valor.
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'qr_rescan',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'disparo_travado',
    'other'
  ));

comment on table public.bulk_sends is
  'Disparo em massa: uma campanha de mensagem para uma lista, por um numero. O ritmo real e o maximo entre interval_ms, channel_knobs.throttle_ms e capabilities.minIntervalMs — o operador pode ir mais devagar, nunca mais rapido.';

comment on table public.bulk_send_recipients is
  'Um destinatario de um disparo, com o desfecho individual. skipped = decisao nossa (bloqueado, sem telefone, recusou), com motivo obrigatorio; failed = o transporte recusou, e so isso se tenta de novo.';

notify pgrst, 'reload schema';
