-- Resolve codes without granting Donato users access to the logistics module.
create function donato_private.price_resolve_article(p_codigo text)
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
    select a.articulo_codigo from public.logistica_articulos a
    where a.articulo_codigo=p_codigo or a.ean_unidad=p_codigo or a.ean_bulto=p_codigo
    limit 3
  ) matches;
  return result;
end;
$$;
revoke all on function donato_private.price_resolve_article(text) from public, anon;
grant usage on schema donato_private to authenticated;
grant execute on function donato_private.price_resolve_article(text) to authenticated;

create function public.donato_price_resolve_article(p_codigo text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select donato_private.price_resolve_article(p_codigo);
$$;
revoke all on function public.donato_price_resolve_article(text) from public, anon;
grant execute on function public.donato_price_resolve_article(text) to authenticated;
