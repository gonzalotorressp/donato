create table public.donato_relevamientos_precios (
  id uuid primary key,
  usuario_id uuid not null default auth.uid() references auth.users(id),
  creado_at timestamptz not null default now(),
  articulo_id text not null check (articulo_id ~ '^[0-9]{1,12}$'),
  contenido jsonb not null check (jsonb_typeof(contenido)='object')
);
create index donato_relevamientos_usuario_fecha on public.donato_relevamientos_precios(usuario_id,creado_at desc);
alter table public.donato_relevamientos_precios enable row level security;
revoke all on public.donato_relevamientos_precios from anon,authenticated;
grant select,insert on public.donato_relevamientos_precios to authenticated;
create policy "Donato surveys own read" on public.donato_relevamientos_precios for select to authenticated
using (public.has_application_access('donato') and (usuario_id=(select auth.uid())
  or public.has_capability('donato.admin') or public.has_capability('donato.encargado')));
create policy "Donato surveys own insert" on public.donato_relevamientos_precios for insert to authenticated
with check (usuario_id=(select auth.uid()) and public.has_application_access('donato'));

alter table public.donato_controles_precios add column relevamiento_id uuid references public.donato_relevamientos_precios(id);
alter table public.donato_ofertas_reportadas add column relevamiento_id uuid references public.donato_relevamientos_precios(id);
create index donato_controles_relevamiento on public.donato_controles_precios(relevamiento_id);
create index donato_ofertas_relevamiento on public.donato_ofertas_reportadas(relevamiento_id);
create policy "Donato controls survey owner" on public.donato_controles_precios as restrictive for insert to authenticated
with check (relevamiento_id is null or exists(select 1 from public.donato_relevamientos_precios r
  where r.id=relevamiento_id and r.usuario_id=(select auth.uid()) and r.articulo_id=donato_controles_precios.articulo_id));
create policy "Donato offers survey owner" on public.donato_ofertas_reportadas as restrictive for insert to authenticated
with check (relevamiento_id is null or exists(select 1 from public.donato_relevamientos_precios r
  where r.id=relevamiento_id and r.usuario_id=(select auth.uid()) and r.articulo_id=donato_ofertas_reportadas.articulo_id));

create function public.donato_guardar_relevamiento_precios(p_id uuid,p_payload jsonb,p_solo_consultar boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  previous_payload jsonb;
  article jsonb := p_payload->'articulo';
  controls jsonb := p_payload->'controles';
  offer jsonb := p_payload->'oferta';
  control jsonb;
  article_id text := article->>'id';
  has_offer boolean := offer is not null and offer <> 'null'::jsonb;
begin
  if auth.uid() is null or not public.has_application_access('donato') then
    raise insufficient_privilege using message='Acceso a Donato requerido';
  end if;
  if p_id is null or article_id is null or article_id !~ '^[0-9]{1,12}$'
    or jsonb_typeof(controls) is distinct from 'array' then
    raise invalid_parameter_value using message='Relevamiento inválido';
  end if;
  if jsonb_array_length(controls)>100 or (jsonb_array_length(controls)=0 and not has_offer) then
    raise invalid_parameter_value using message='Marcá al menos un control o informá una oferta';
  end if;
  select r.contenido into previous_payload from public.donato_relevamientos_precios r
    where r.id=p_id and r.usuario_id=auth.uid();
  if found then
    if previous_payload is distinct from p_payload then
      raise exception 'El relevamiento ya se guardó con otros datos. Volvé a consultar el artículo';
    end if;
    return jsonb_build_object('id',p_id,'guardado',true);
  end if;
  if p_solo_consultar then return jsonb_build_object('id',p_id,'guardado',false); end if;
  insert into public.donato_relevamientos_precios(id,articulo_id,contenido)
    values(p_id,article_id,p_payload) on conflict(id) do nothing;
  if not found then
    select r.contenido into previous_payload from public.donato_relevamientos_precios r
      where r.id=p_id and r.usuario_id=auth.uid();
    if previous_payload is distinct from p_payload then raise exception 'Identificador de relevamiento en uso'; end if;
    return jsonb_build_object('id',p_id,'guardado',true);
  end if;
  for control in select value from jsonb_array_elements(controls) loop
    insert into public.donato_controles_precios(articulo_id,descripcion,precio_lista_con_iva,
      estado,precio_observado,politica_id,politica_snapshot,precio_politica_neto,precio_politica_con_iva,relevamiento_id)
    values(article_id,article->>'descripcion',(article->>'precio_lista_con_iva')::numeric,
      control->>'estado',(control->>'precio_observado')::numeric,control->>'politica_id',
      nullif(control->'politica_snapshot','null'::jsonb),(control->>'precio_politica_neto')::numeric,
      (control->>'precio_politica_con_iva')::numeric,p_id);
  end loop;
  if has_offer then
    insert into public.donato_ofertas_reportadas(id,articulo_id,descripcion,precio_lista_con_iva,
      precio_cartel,observacion,foto_path,politicas_snapshot,relevamiento_id)
    values((offer->>'id')::uuid,article_id,article->>'descripcion',(article->>'precio_lista_con_iva')::numeric,
      (offer->>'precio_cartel')::numeric,offer->>'observacion',offer->>'foto_path',offer->'politicas_snapshot',p_id);
  end if;
  return jsonb_build_object('id',p_id,'guardado',true);
end;
$$;
revoke all on function public.donato_guardar_relevamiento_precios(uuid,jsonb,boolean) from public,anon;
grant execute on function public.donato_guardar_relevamiento_precios(uuid,jsonb,boolean) to authenticated;
