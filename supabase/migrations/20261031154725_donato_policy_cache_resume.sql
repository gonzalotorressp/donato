alter table donato_private.policy_cache
  add column staged_rows jsonb not null default '[]'::jsonb,
  add column staged_page integer not null default 1,
  add column staging_at timestamptz,
  add column next_retry_at timestamptz;

create or replace function donato_private.policy_cache_access(
  p_action text, p_secret text, p_force boolean default false,
  p_lease uuid default null, p_payload jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v donato_private.policy_cache%rowtype;
  new_lease uuid;
  retry_seconds integer;
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
      return jsonb_build_object('cached', false, 'lease', null, 'retryAfter', 3);
    end if;
    if v.next_retry_at > clock_timestamp() then
      retry_seconds := greatest(1, ceil(extract(epoch from v.next_retry_at - clock_timestamp()))::integer);
      return jsonb_build_object('cached', false, 'lease', null, 'retryAfter', retry_seconds);
    end if;
    if v.staging_at is null or v.staging_at < clock_timestamp() - interval '10 minutes' then
      v.staged_rows := '[]'::jsonb;
      v.staged_page := 1;
      v.staging_at := clock_timestamp();
    end if;
    new_lease := gen_random_uuid();
    update donato_private.policy_cache set lease = new_lease,
      lease_until = clock_timestamp() + interval '90 seconds',
      staged_rows = v.staged_rows, staged_page = v.staged_page,
      staging_at = v.staging_at, next_retry_at = null where id;
    return jsonb_build_object('cached', false, 'lease', new_lease,
      'stagedRows', v.staged_rows, 'page', v.staged_page);
  elsif p_action in ('publish', 'stage') then
    if p_lease is null or v.lease is distinct from p_lease or v.lease_until <= clock_timestamp() then
      raise exception 'La actualización perdió su bloqueo';
    end if;
    if p_action = 'publish' then
      if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
        raise exception 'Formato de políticas inválido';
      end if;
      update donato_private.policy_cache set payload = p_payload,
        updated_at = clock_timestamp(), lease = null, lease_until = null,
        staged_rows = '[]'::jsonb, staged_page = 1, staging_at = null, next_retry_at = null
        where id returning * into v;
      return jsonb_build_object('updatedAt', v.updated_at);
    end if;
    if jsonb_typeof(p_payload->'rows') is distinct from 'array'
      or coalesce((p_payload->>'page')::integer, 0) not between 1 and 10 then
      raise exception 'Avance de descarga inválido';
    end if;
    if jsonb_array_length(p_payload->'rows') > 10000 then
      raise exception 'Avance de descarga demasiado grande';
    end if;
    retry_seconds := greatest(1, least(3600, coalesce((p_payload->>'retryAfter')::integer, 30)));
    update donato_private.policy_cache set staged_rows = p_payload->'rows',
      staged_page = (p_payload->>'page')::integer,
      next_retry_at = clock_timestamp() + make_interval(secs => retry_seconds),
      lease = null, lease_until = null where id;
    return jsonb_build_object('retryAfter', retry_seconds);
  elsif p_action = 'release' then
    update donato_private.policy_cache set lease = null, lease_until = null
      where id and lease = p_lease;
    return '{}'::jsonb;
  end if;
  raise exception 'Acción de caché inválida';
end;
$$;
