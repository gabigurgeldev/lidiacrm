-- ============================================================================
-- 0225 — RETENÇÃO DAS INTEGRAÇÕES VIA API.
--
-- A quinta poda do cron `data-retention`, com a mesma assinatura das irmãs
-- (`p_retencao_dias`, `p_limite`) para o mesmo laço de lotes servir.
--
--   - `ai_api_chamadas` mais velhas que `p_retencao_dias` (padrão 90, piso 30
--     NO CORPO — vale até para um `psql` na mão);
--   - `ai_api_verificacoes` com mais de 30 dias, fixo: guardam o e-mail cifrado
--     de quem pediu o código, e a sessão mais longa dura 24 horas. Uma
--     verificação ainda `pendente` com 30 dias já venceu há muito (o código vale
--     10 minutos), então entra também.
--
-- `ai_api_acoes_pendentes` fica: é o histórico de correções aplicadas com o SIM
-- do titular, alcançado pela cascata de LGPD (passo 6d) e pelo export.
-- ============================================================================

create or replace function public.fn_expurgar_integracoes_api(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 90), 30);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_chamadas int;
  v_verificacoes int;
begin
  with vencidas as (
    select c.id
      from public.ai_api_chamadas c
     where c.created_at < now() - make_interval(days => v_dias)
     order by c.created_at
     limit v_limite
  )
  delete from public.ai_api_chamadas c
   using vencidas v
   where c.id = v.id;
  get diagnostics v_chamadas = row_count;

  with vencidas as (
    select x.id
      from public.ai_api_verificacoes x
     where x.created_at < now() - interval '30 days'
     order by x.created_at
     limit v_limite
  )
  delete from public.ai_api_verificacoes x
   using vencidas v
   where x.id = v.id;
  get diagnostics v_verificacoes = row_count;

  return v_chamadas + v_verificacoes;
end;
$$;

revoke execute on function public.fn_expurgar_integracoes_api(int, int) from public, anon, authenticated;
grant  execute on function public.fn_expurgar_integracoes_api(int, int) to service_role;

notify pgrst, 'reload schema';
