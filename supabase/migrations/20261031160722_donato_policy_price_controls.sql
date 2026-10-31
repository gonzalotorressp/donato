alter table public.donato_controles_precios
  add column politica_id text,
  add column politica_snapshot jsonb,
  add column precio_politica_neto numeric,
  add column precio_politica_con_iva numeric,
  add constraint donato_controles_precios_politica_context check (
    (politica_id is null and politica_snapshot is null
      and precio_politica_neto is null and precio_politica_con_iva is null)
    or (politica_id is not null and politica_snapshot is not null
      and jsonb_typeof(politica_snapshot) = 'object'
      and politica_snapshot->>'id' is not null
      and politica_snapshot->>'id' = politica_id)
  );

comment on column public.donato_controles_precios.politica_id is
  'NULL identifica el control del precio de lista; cada política se registra por separado.';
comment on column public.donato_controles_precios.precio_politica_con_iva is
  'Precio fijo de la política más IVA del artículo al controlar la etiqueta. NULL en políticas sin precio fijo o sin IVA validado.';
-- Existing own-row INSERT/SELECT RLS policies also protect these columns.
