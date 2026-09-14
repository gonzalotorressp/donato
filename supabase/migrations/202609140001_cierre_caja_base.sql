create extension if not exists pgcrypto;

create table if not exists public.perfiles_usuario (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nombre text,
  rol text not null default 'supervisor_caja' check (rol in ('supervisor_caja','encargado_donato','administrador')),
  activo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  usuario_sigma_codigo integer not null,
  usuario_sigma_nombre text not null,
  caja_codigo integer not null,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','PENDIENTE_VALIDACION','CERRADO','AJUSTES_AUTORIZADOS','AJUSTADO')),
  supervisor_user_id uuid references public.perfiles_usuario(user_id),
  encargado_user_id uuid references public.perfiles_usuario(user_id),
  venta_sigma numeric(18,2) not null default 0,
  efectivo_sigma numeric(18,2) not null default 0,
  clover_sigma numeric(18,2) not null default 0,
  payway_sigma numeric(18,2) not null default 0,
  naranja_sigma numeric(18,2) not null default 0,
  retiros_sigma numeric(18,2) not null default 0,
  cuenta_corriente_sigma numeric(18,2) not null default 0,
  clover_fisico numeric(18,2) not null default 0,
  payway_fisico numeric(18,2) not null default 0,
  cashback_fisico numeric(18,2) not null default 0,
  efectivo_cierre numeric(18,2) not null default 0,
  efectivo_rendido numeric(18,2) not null default 0,
  diferencia_efectivo numeric(18,2) not null default 0,
  observaciones text,
  submitted_at timestamptz,
  validated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fecha, usuario_sigma_codigo, caja_codigo)
);

create table if not exists public.cierre_retiros (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.cierres_caja(id) on delete cascade,
  tipo text not null check (tipo in ('depositario','supervisor','cierre')),
  importe numeric(18,2) not null check (importe >= 0),
  ticket_referencia text,
  observacion text,
  created_by uuid references public.perfiles_usuario(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.cierre_cuentas_corrientes (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.cierres_caja(id) on delete cascade,
  comprobante text not null,
  cliente_codigo text,
  cliente_nombre text,
  importe numeric(18,2) not null,
  documentacion_recibida boolean not null default false,
  observacion text,
  created_at timestamptz not null default now()
);

create table if not exists public.cierre_ajustes (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.cierres_caja(id) on delete cascade,
  tipo text not null check (tipo in ('reclasificacion_medio','regularizacion_retiro','sobrante_caja','faltante_caja','otro')),
  importe numeric(18,2) not null check (importe >= 0),
  cuenta_origen text,
  cuenta_destino text,
  motivo text not null,
  estado text not null default 'PROPUESTO' check (estado in ('PROPUESTO','APROBADO','RECHAZADO','EJECUTADO')),
  aprobado_por uuid references public.perfiles_usuario(user_id),
  aprobado_at timestamptz,
  ejecutado_at timestamptz,
  sigma_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cierre_auditoria (
  id bigint generated always as identity primary key,
  cierre_id uuid references public.cierres_caja(id) on delete cascade,
  user_id uuid references public.perfiles_usuario(user_id),
  accion text not null,
  detalle jsonb,
  created_at timestamptz not null default now()
);

alter table public.perfiles_usuario enable row level security;
alter table public.cierres_caja enable row level security;
alter table public.cierre_retiros enable row level security;
alter table public.cierre_cuentas_corrientes enable row level security;
alter table public.cierre_ajustes enable row level security;
alter table public.cierre_auditoria enable row level security;

create policy "usuario_lee_perfil" on public.perfiles_usuario
for select to authenticated using (user_id = auth.uid());

create policy "usuarios_activos_leen_cierres" on public.cierres_caja
for select to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
);

create policy "supervisor_crea_cierres" on public.cierres_caja
for insert to authenticated with check (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo and p.rol in ('supervisor_caja','administrador'))
);

create policy "supervisor_actualiza_borradores" on public.cierres_caja
for update to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo and p.rol in ('supervisor_caja','encargado_donato','administrador'))
);

create policy "usuarios_activos_detalle_retiros" on public.cierre_retiros
for all to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
) with check (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
);

create policy "usuarios_activos_detalle_cc" on public.cierre_cuentas_corrientes
for all to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
) with check (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
);

create policy "usuarios_activos_ajustes" on public.cierre_ajustes
for select to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
);

create policy "encargado_gestiona_ajustes" on public.cierre_ajustes
for all to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo and p.rol in ('encargado_donato','administrador'))
) with check (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo and p.rol in ('encargado_donato','administrador'))
);

create policy "usuarios_activos_lee_auditoria" on public.cierre_auditoria
for select to authenticated using (
  exists (select 1 from public.perfiles_usuario p where p.user_id = auth.uid() and p.activo)
);

create or replace function public.handle_new_donato_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.perfiles_usuario (user_id, email, nombre, activo)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    false
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_donato_user_created
after insert on auth.users
for each row execute procedure public.handle_new_donato_user();
