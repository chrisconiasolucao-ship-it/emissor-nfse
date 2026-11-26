-- 0009 — bloqueio de login: 3 falhas seguidas em 15 min bloqueiam por 15 min (AT-023, Decision 9).

create table public.login_tentativa (
  id bigint generated always as identity primary key,
  email text not null,
  ip inet,
  sucesso boolean not null,
  quando timestamptz not null default clock_timestamp()
);
create index login_tentativa_email on public.login_tentativa (email, quando desc);
alter table public.login_tentativa enable row level security;
revoke all on public.login_tentativa from anon, authenticated;

-- Devolve até quando o e-mail está bloqueado (null = liberado).
create or replace function public.fn_login_bloqueado_ate(p_email text, p_max integer default 3, p_minutos integer default 15)
returns timestamptz language sql stable security definer set search_path = public as $$
  with recentes as (
    select sucesso, quando from public.login_tentativa
     where email = lower(trim(p_email)) and quando > now() - make_interval(mins => p_minutos)
     order by quando desc limit p_max
  )
  select case
    when (select count(*) from recentes) = p_max and not exists (select 1 from recentes where sucesso)
    then (select max(quando) from recentes) + make_interval(mins => p_minutos)
  end
$$;

create or replace function public.fn_registrar_login(p_email text, p_ip inet, p_sucesso boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.login_tentativa (email, ip, sucesso) values (lower(trim(p_email)), p_ip, p_sucesso)
$$;

revoke all on function public.fn_login_bloqueado_ate(text, integer, integer), public.fn_registrar_login(text, inet, boolean)
  from public, anon, authenticated;
grant execute on function public.fn_login_bloqueado_ate(text, integer, integer), public.fn_registrar_login(text, inet, boolean)
  to service_role;

-- Hook "Password Verification Attempt" do Supabase Auth: aplica a mesma regra na origem, quando o plano
-- permitir ligar o hook (Authentication → Hooks). Sem o hook ligado, vale só o bloqueio de /api/auth/login.
create or replace function public.hook_verificacao_senha(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; v_ate timestamptz;
begin
  select email into v_email from auth.users where id = (event ->> 'user_id')::uuid;
  perform public.fn_registrar_login(v_email, null, (event ->> 'valid')::boolean);
  v_ate := public.fn_login_bloqueado_ate(v_email);
  if v_ate is not null then
    return jsonb_build_object('decision', 'reject',
      'message', 'Acesso bloqueado por 15 minutos após 3 senhas erradas.', 'should_logout_user', false);
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;
revoke all on function public.hook_verificacao_senha(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_verificacao_senha(jsonb) to supabase_auth_admin;
    grant usage on schema public to supabase_auth_admin;
  end if;
end $$;
