-- Extend the existing Donato-only lookup; keep the private authorization check
-- and the public invoker wrapper/permissions unchanged.
create or replace function donato_private.price_resolve_article(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_application_access('donato') then
    raise insufficient_privilege using message='Acceso a Donato requerido';
  end if;
  p_codigo := btrim(p_codigo);
  if p_codigo is null or p_codigo !~ '^[0-9]{1,14}$' then
    raise invalid_parameter_value using message='Código Sigma o EAN inválido';
  end if;
  select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) into result
  from (
    select a.articulo_codigo, a.ean_unidad, a.unidades_por_bulto, a.synced_at
    from public.logistica_articulos a
    where a.articulo_codigo=p_codigo or a.ean_unidad=p_codigo or a.ean_bulto=p_codigo
    limit 3
  ) matches;
  return result;
end;
$$;
revoke all on function donato_private.price_resolve_article(text) from public, anon;
grant execute on function donato_private.price_resolve_article(text) to authenticated;
