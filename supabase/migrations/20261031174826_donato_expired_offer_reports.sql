create table public.donato_ofertas_reportadas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users(id),
  creado_at timestamptz not null default now(),
  articulo_id text not null check (articulo_id ~ '^[0-9]{1,12}$'),
  descripcion text,
  precio_lista_con_iva numeric,
  precio_cartel numeric check (precio_cartel >= 0),
  observacion text check (length(observacion) <= 2000),
  foto_path text not null unique,
  estado text not null default 'pendiente_revision' check (estado = 'pendiente_revision'),
  politicas_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(politicas_snapshot) = 'object'),
  constraint donato_offer_photo_owner check (foto_path = usuario_id::text || '/' || id::text || '.jpg')
);
create index donato_ofertas_reportadas_usuario_fecha on public.donato_ofertas_reportadas(usuario_id, creado_at desc);
alter table public.donato_ofertas_reportadas enable row level security;
revoke all on public.donato_ofertas_reportadas from anon, authenticated;
grant select, insert on public.donato_ofertas_reportadas to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('donato-ofertas-carteles','donato-ofertas-carteles',false,10485760,array['image/jpeg']);

create policy "Donato offer photos read" on storage.objects for select to authenticated
using (bucket_id='donato-ofertas-carteles' and public.has_application_access('donato') and (
  (storage.foldername(name))[1]=(select auth.uid())::text
  or public.has_capability('donato.admin') or public.has_capability('donato.encargado')
));
create policy "Donato offer photos upload" on storage.objects for insert to authenticated
with check (bucket_id='donato-ofertas-carteles' and public.has_application_access('donato')
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');

create policy "Donato offers read" on public.donato_ofertas_reportadas for select to authenticated
using (public.has_application_access('donato') and (
  usuario_id=(select auth.uid()) or public.has_capability('donato.admin') or public.has_capability('donato.encargado')
));
create policy "Donato offers report with photo" on public.donato_ofertas_reportadas for insert to authenticated
with check (usuario_id=(select auth.uid()) and public.has_application_access('donato')
  and exists(select 1 from storage.objects o where o.bucket_id='donato-ofertas-carteles' and o.name=foto_path));
create policy "Donato offer photos cleanup" on storage.objects for delete to authenticated
using (bucket_id='donato-ofertas-carteles' and public.has_application_access('donato')
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and not exists(select 1 from public.donato_ofertas_reportadas r where r.foto_path=name));
