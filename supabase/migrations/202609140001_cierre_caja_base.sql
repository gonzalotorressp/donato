create extension if not exists pgcrypto;

-- Donato comparte identidad y autenticacion con la plataforma San Pablo.
-- No se crean perfiles ni triggers de auth nuevos: se reutilizan
-- public.profiles, public.applications, public.user_application_access,
-- public.capabilities y public.user_capabilities.

insert into public.applications (code, name, active)
values ('donato', 'Donato', true)
on conflict (code) do update
set name = excluded.name,
    active = true;

insert into public.capabilities (code, name, application_id)
select v.code, v.name, a.id
from (
  values
    ('donato.supervisor_caja', 'Supervisor de caja Donato'),
    ('donato.encargado', 'Encargado Donato'),
    ('donato.admin', 'Administrador Donato')
) as v(code, name)
join public.applications a on a.code = 'donato'
on conflict (code) do update
set name = excluded.name,
    application_id = excluded.application_id;

-- Los administradores actuales de la plataforma reciben acceso inicial a Donato.
insert into public.user_application_access (user_id, application_id, granted_by)
select distinct uc.user_id, a.id, uc.user_id
from public.user_capabilities uc
join public.capabilities platform_cap on platform_cap.id = uc.capability_id
join public.applications a on a.code = 'donato'
where platform_cap.code = 'usuarios.admin'
on conflict do nothing;

insert into public.user_capabilities (user_id, capability_id, granted_by)
select distinct uc.user_id, donato_admin.id, uc.user_id
from public.user_capabilities uc
join public.capabilities platform_cap on platform_cap.id = uc.capability_id
join public.capabilities donato_admin on donato_admin.code = 'donato.admin'
where platform_cap.code = 'usuarios.admin'
on conflict do nothing;

create or replace function public.has_application_access(
  application_code text,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_application_access uaa on uaa.user_id = p.id
    join public.applications a on a.id = uaa.application_id
    where p.id = check_user_id
      and p.status = 'active'
      and p.active = true
      and a.code = application_code
      and a.active = true
  );
$$;

create or replace function public.has_capability(
  capability_code text,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_capabilities uc on uc.user_id = p.id
    join public.capabilities c on c.id = uc.capability_id
    where p.id = check_user_id
      and p.status = 'active'
      and p.active = true
      and c.code = capability_code
  );
$$;

create or replace function public.admin_set_donato_role(
  target_user_id uuid,
  target_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  donato_app_id uuid;
  target_capability_id uuid;
  target_capability_code text;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;

  if target_role not in ('supervisor_caja', 'encargado', 'admin') then
    raise exception 'invalid_donato_role';
  end if;

  target_capability_code := 'donato.' || target_role;

  select id into donato_app_id
  from public.applications
  where code = 'donato' and active = true;

  select id into target_capability_id
  from public.capabilities
  where code = target_capability_code
    and application_id = donato_app_id;

  if donato_app_id is null or target_capability_id is null then
    raise exception 'donato_configuration_missing';
  end if;

  insert into public.user_application_access (user_id, application_id, granted_by)
  values (target_user_id, donato_app_id, auth.uid())
  on conflict do nothing;

  delete from public.user_capabilities uc
  using public.capabilities c
  where uc.user_id = target_user_id
    and uc.capability_id = c.id
    and c.application_id = donato_app_id
    and c.code in ('donato.supervisor_caja', 'donato.encargado', 'donato.admin');

  insert into public.user_capabilities (user_id, capability_id, granted_by)
  values (target_user_id, target_capability_id, auth.uid())
  on conflict do nothing;

  insert into public.audit_events (actor_user_id, subject_user_id, action, details)
  values (
    auth.uid(),
    target_user_id,
    'donato.role.changed',
    jsonb_build_object('role', target_role)
  );
end;
$$;

create table if not exists public.donato_cierres_caja (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  usuario_sigma_codigo integer not null,
  usuario_sigma_nombre text not null,
  caja_codigo integer not null,
  estado text not null default 'BORRADOR'
    check (estado in ('BORRADOR','PENDIENTE_VALIDACION','CERRADO','AJUSTES_AUTORIZADOS','AJUSTADO')),
  supervisor_user_id uuid not null references public.profiles(id),
  encargado_user_id uuid references public.profiles(id),
  venta_sigma numeric(18,2) not null default 0,
  efectivo_sigma numeric(18,2) not null default 0,
  clover_sigma numeric(18,2) not null default 0,
  payway_sigma numeric(18,2) not null default 0,
  naranja_sigma numeric(18,2) not null default 0,
  cashback_sigma numeric(18,2) not null default 0,
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

create table if not exists public.donato_cierre_retiros (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.donato_cierres_caja(id) on delete cascade,
  tipo text not null check (tipo in ('depositario','supervisor','cierre')),
  importe numeric(18,2) not null check (importe >= 0),
  ticket_referencia text,
  observacion text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.donato_cierre_cashback (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.donato_cierres_caja(id) on delete cascade,
  importe numeric(18,2) not null check (importe >= 0),
  referencia text,
  observacion text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.donato_cierre_cuentas_corrientes (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.donato_cierres_caja(id) on delete cascade,
  comprobante text not null,
  cliente_codigo text,
  cliente_nombre text,
  importe numeric(18,2) not null,
  documentacion_recibida boolean not null default false,
  observacion text,
  created_at timestamptz not null default now()
);

create table if not exists public.donato_cierre_ajustes (
  id uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.donato_cierres_caja(id) on delete cascade,
  tipo text not null
    check (tipo in ('reclasificacion_medio','regularizacion_retiro','sobrante_caja','faltante_caja','cashback','otro')),
  importe numeric(18,2) not null check (importe >= 0),
  cuenta_origen text,
  cuenta_destino text,
  motivo text not null,
  estado text not null default 'PROPUESTO'
    check (estado in ('PROPUESTO','APROBADO','RECHAZADO','EJECUTADO')),
  aprobado_por uuid references public.profiles(id),
  aprobado_at timestamptz,
  ejecutado_at timestamptz,
  sigma_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.donato_cierre_auditoria (
  id bigint generated always as identity primary key,
  cierre_id uuid references public.donato_cierres_caja(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  accion text not null,
  detalle jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.donato_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists donato_cierres_touch_updated_at on public.donato_cierres_caja;
create trigger donato_cierres_touch_updated_at
before update on public.donato_cierres_caja
for each row execute function public.donato_touch_updated_at();

alter table public.donato_cierres_caja enable row level security;
alter table public.donato_cierre_retiros enable row level security;
alter table public.donato_cierre_cashback enable row level security;
alter table public.donato_cierre_cuentas_corrientes enable row level security;
alter table public.donato_cierre_ajustes enable row level security;
alter table public.donato_cierre_auditoria enable row level security;

grant select, insert, update, delete on public.donato_cierres_caja to authenticated;
grant select, insert, update, delete on public.donato_cierre_retiros to authenticated;
grant select, insert, update, delete on public.donato_cierre_cashback to authenticated;
grant select, insert, update, delete on public.donato_cierre_cuentas_corrientes to authenticated;
grant select, insert, update, delete on public.donato_cierre_ajustes to authenticated;
grant select, insert on public.donato_cierre_auditoria to authenticated;
grant usage, select on sequence public.donato_cierre_auditoria_id_seq to authenticated;

create policy "donato_usuarios_leen_cierres" on public.donato_cierres_caja
for select to authenticated
using (public.has_application_access('donato'));

create policy "donato_supervisor_crea_cierres" on public.donato_cierres_caja
for insert to authenticated
with check (
  supervisor_user_id = auth.uid()
  and (
    public.has_capability('donato.supervisor_caja')
    or public.has_capability('donato.admin')
  )
  and estado in ('BORRADOR','PENDIENTE_VALIDACION')
);

create policy "donato_supervisor_actualiza_su_cierre" on public.donato_cierres_caja
for update to authenticated
using (
  supervisor_user_id = auth.uid()
  and estado in ('BORRADOR','PENDIENTE_VALIDACION')
  and (
    public.has_capability('donato.supervisor_caja')
    or public.has_capability('donato.admin')
  )
)
with check (
  supervisor_user_id = auth.uid()
  and estado in ('BORRADOR','PENDIENTE_VALIDACION')
);

create policy "donato_encargado_valida_cierres" on public.donato_cierres_caja
for update to authenticated
using (
  public.has_capability('donato.encargado')
  or public.has_capability('donato.admin')
)
with check (
  public.has_capability('donato.encargado')
  or public.has_capability('donato.admin')
);

create policy "donato_detalle_retiros_lectura" on public.donato_cierre_retiros
for select to authenticated
using (public.has_application_access('donato'));

create policy "donato_supervisor_gestiona_retiros" on public.donato_cierre_retiros
for all to authenticated
using (
  created_by = auth.uid()
  and (
    public.has_capability('donato.supervisor_caja')
    or public.has_capability('donato.admin')
  )
)
with check (
  created_by = auth.uid()
  and (
    public.has_capability('donato.supervisor_caja')
    or public.has_capability('donato.admin')
  )
);

create policy "donato_cashback_lectura" on public.donato_cierre_cashback
for select to authenticated
using (public.has_application_access('donato'));

create policy "donato_supervisor_gestiona_cashback" on public.donato_cierre_cashback
for all to authenticated
using (
  created_by = auth.uid()
  and (
    public.has_capability('donato.supervisor_caja')
    or public.has_capability('donato.admin')
  )
)
with check (
  created_by = auth.uid()
  and (
    public.has_capability('donato.supervisor_caja')
    or public.has_capability('donato.admin')
  )
);

create policy "donato_cc_lectura" on public.donato_cierre_cuentas_corrientes
for select to authenticated
using (public.has_application_access('donato'));

create policy "donato_supervisor_gestiona_cc" on public.donato_cierre_cuentas_corrientes
for all to authenticated
using (
  public.has_capability('donato.supervisor_caja')
  or public.has_capability('donato.admin')
)
with check (
  public.has_capability('donato.supervisor_caja')
  or public.has_capability('donato.admin')
);

create policy "donato_ajustes_lectura" on public.donato_cierre_ajustes
for select to authenticated
using (public.has_application_access('donato'));

create policy "donato_encargado_gestiona_ajustes" on public.donato_cierre_ajustes
for all to authenticated
using (
  public.has_capability('donato.encargado')
  or public.has_capability('donato.admin')
)
with check (
  public.has_capability('donato.encargado')
  or public.has_capability('donato.admin')
);

create policy "donato_auditoria_lectura" on public.donato_cierre_auditoria
for select to authenticated
using (public.has_application_access('donato'));

create policy "donato_auditoria_inserta" on public.donato_cierre_auditoria
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_application_access('donato')
);
