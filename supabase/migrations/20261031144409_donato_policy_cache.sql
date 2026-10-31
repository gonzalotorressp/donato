-- Dedicated private cache; only the server with a Donato session and a scoped
-- secret can read, claim or replace the shared Sigma snapshot.
create schema if not exists donato_private;
revoke all on schema donato_private from public, anon;
grant usage on schema donato_private to authenticated;

create table donato_private.policy_cache (
  id boolean primary key default true check (id),
  secret_hash text,
  payload jsonb,
  updated_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  check (payload is null or jsonb_typeof(payload) = 'array')
);
alter table donato_private.policy_cache enable row level security;
revoke all on donato_private.policy_cache from public, anon, authenticated;
insert into donato_private.policy_cache(id) values (true);

create function donato_private.policy_cache_access(
  p_action text, p_secret text, p_force boolean default false,
  p_lease uuid default null, p_payload jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v donato_private.policy_cache%rowtype;
  new_lease uuid;
begin
  if auth.uid() is null or not public.has_application_access('donato') then
    raise insufficient_privilege using message = 'Acceso a Donato requerido';
  end if;
  select * into v from donato_private.policy_cache where id for update;
  if p_secret is null or v.secret_hash is null
    or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex') <> v.secret_hash then
    raise insufficient_privilege using message = 'Credencial de caché inválida';
  end if;
  if p_action = 'claim' then
    if not coalesce(p_force, false) and v.updated_at > clock_timestamp() - interval '60 minutes'
      and v.payload is not null then
      return jsonb_build_object('cached', true, 'complete', true, 'rows', v.payload, 'updatedAt', v.updated_at);
    end if;
    if v.lease_until > clock_timestamp() then
      return jsonb_build_object('cached', false, 'lease', null);
    end if;
    new_lease := gen_random_uuid();
    update donato_private.policy_cache set lease = new_lease,
      lease_until = clock_timestamp() + interval '90 seconds' where id;
    return jsonb_build_object('cached', false, 'lease', new_lease);
  elsif p_action = 'publish' then
    if p_lease is null or v.lease is distinct from p_lease or v.lease_until <= clock_timestamp() then
      raise exception 'La actualización perdió su bloqueo';
    end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
      raise exception 'Formato de políticas inválido';
    end if;
    update donato_private.policy_cache set payload = p_payload,
      updated_at = clock_timestamp(), lease = null, lease_until = null where id
      returning * into v;
    return jsonb_build_object('updatedAt', v.updated_at);
  elsif p_action = 'release' then
    update donato_private.policy_cache set lease = null, lease_until = null
      where id and lease = p_lease;
    return '{}'::jsonb;
  end if;
  raise exception 'Acción de caché inválida';
end;
$$;
revoke all on function donato_private.policy_cache_access(text,text,boolean,uuid,jsonb) from public, anon;
grant execute on function donato_private.policy_cache_access(text,text,boolean,uuid,jsonb) to authenticated;

-- Public API wrapper runs as the caller. The private implementation checks both
-- auth.uid()/Donato access and the server-only secret before elevating access.
create function public.donato_policy_cache(
  p_action text, p_secret text, p_force boolean default false,
  p_lease uuid default null, p_payload jsonb default null
) returns jsonb
language sql security invoker set search_path = '' as $$
  select donato_private.policy_cache_access(p_action,p_secret,p_force,p_lease,p_payload);
$$;
revoke all on function public.donato_policy_cache(text,text,boolean,uuid,jsonb) from public, anon;
grant execute on function public.donato_policy_cache(text,text,boolean,uuid,jsonb) to authenticated;
