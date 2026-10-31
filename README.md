# Donato

Plataforma operativa de Donato. Primer módulo: **Cierre de Caja**.

## Arquitectura

Donato reutiliza el proyecto Supabase existente de **Operación Logística San Pablo** para evitar crear un proyecto adicional.

Se comparte únicamente la capa de identidad y acceso:

- `profiles`
- `applications`
- `user_application_access`
- `capabilities`
- `user_capabilities`
- Supabase Auth / Google OAuth

Los datos funcionales de Donato permanecen separados en tablas con prefijo `donato_`.

La aplicación registrada es `donato` y sus capacidades son:

- `donato.supervisor_caja`
- `donato.encargado`
- `donato.admin`

Los administradores de plataforma existentes reciben acceso inicial a Donato. Para asignar un rol Donato desde administración puede utilizarse el RPC `admin_set_donato_role(user_id, role)` con roles `supervisor_caja`, `encargado` o `admin`.

## Flujo inicial

1. Supervisor de Caja selecciona cajero/jornada.
2. Carga cierres físicos de Clover y Payway.
3. Carga tickets del depositario, retiros de supervisores, cashback y efectivo de cierre.
4. Confirma documentación de facturas en cuenta corriente.
5. La aplicación compara físico vs Sigma.
6. Si todo coincide, la jornada puede cerrarse.
7. Si hay diferencias, queda `PENDIENTE_VALIDACION`.
8. El Encargado Donato revisa y autoriza/rechaza los ajustes propuestos.
9. Sólo con ajustes autorizados se habilita la futura ejecución de asientos en Sigma.

## Roles de interfaz

- `supervisor_caja`: carga y presenta cierres.
- `encargado_donato`: valida diferencias y autoriza ajustes.
- `administrador`: acceso completo.

Estos roles de interfaz se resuelven desde las capacidades compartidas de plataforma.

## Variables Vercel

Reutilizar la URL y publishable key del proyecto Supabase de Operación Logística:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SIGMA_API_TOKEN=
SIGMA_BASE_URL=https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api
```

`SIGMA_API_TOKEN` es sólo de servidor y nunca debe exponerse con prefijo `VITE_`.

## Caché de políticas de precios

`/api/sigma/politicas-articulo` comparte una descarga completa de políticas de Sigma
durante 60 minutos en Supabase (`donato_private.policy_cache`). La evaluación por
artículo conserva empresa 0001, sucursal 0004, lista 4 y excluye políticas de clientes.
`force=1` fuerza la descarga; un bloqueo de 90 segundos evita exportaciones concurrentes.
Los errores o descargas incompletas conservan la última versión y liberan el bloqueo.

El contexto del artículo viaja firmado desde la consulta de precio para evitar
repetir `ExportArticulos`. Si Sigma devuelve 429, se guarda el avance de la
exportación y su espera indicada (`Retry-After` o `wait Nms`). La API devuelve 202
y la pantalla reintenta automáticamente desde la página pendiente, sin publicar
datos parciales. El avance vence a los 10 minutos; el snapshot completo dura 60.
Aplicar también `supabase/migrations/20261031154725_donato_policy_cache_resume.sql`.

Aplicar `supabase/migrations/20261031144409_donato_policy_cache.sql`. Configurar un
secreto aleatorio `DONATO_POLICY_CACHE_SECRET` únicamente en el servidor de Vercel
y su SHA-256 hexadecimal en `donato_private.policy_cache.secret_hash`. No incluir
el valor en el repositorio ni usar un prefijo `VITE_`. El RPC requiere además una
sesión activa con acceso a Donato. No necesita una clave `service_role`.

`npm test` verifica la sintaxis de todas las APIs y cubre caché, renovación forzada,
paginación, bloqueo, errores de Sigma y respuestas que no son JSON.

Cada política tiene un control independiente (correcto, incorrecto o no presente).
La migración `supabase/migrations/20261031160722_donato_policy_price_controls.sql`
agrega su ID, snapshot y precio fijo neto/con IVA al registro de control. El
historial distingue controles del precio de lista y de cada política; la
selección visual requiere guardar y los registros conservan el RLS por usuario.

Todos los controles de lista/políticas y el aviso de oferta se confirman juntos
con **Guardar relevamiento**, al final del formulario. Los componentes sólo
editan borradores; no guardan por separado. Aplicar
`supabase/migrations/20261031183131_donato_price_survey_batch.sql`.
El RPC `donato_guardar_relevamiento_precios` crea una cabecera con usuario y hora,
controles y aviso en una única transacción. El mismo ID permite reintentar sin
duplicar registros; una foto que quedó vinculada se conserva ante errores de red.

## Carteles de oferta sin política vigente

El control de precios permite informar una oferta no vigente con foto obligatoria,
precio del cartel y observación opcionales. Las fotos se reducen a 1600 px y se
guardan como JPEG en el bucket privado `donato-ofertas-carteles`. El registro
`donato_ofertas_reportadas` conserva artículo, autor, precio de lista, evidencia
de las políticas consultadas y estado pendiente de revisión.

Aplicar `supabase/migrations/20261031174826_donato_expired_offer_reports.sql`.
RLS permite cargar fotos en la carpeta propia, ver los avisos propios (o revisar
con capacidades Donato admin/encargado) y limpiar sólo fotos todavía no asociadas
a un aviso. La pantalla abre las fotos con URLs firmadas por cinco minutos.

## Base de datos

El buscador de precios usa un único campo vacío para código Sigma o EAN. Los EAN
de unidad/bulto se resuelven al código de artículo mediante el RPC
`donato_price_resolve_article`, restringido a usuarios activos de Donato sin abrir
permisos del módulo logístico. Aplicar
`supabase/migrations/20261031180853_donato_price_article_lookup.sql`.

Migraciones:

- `supabase/migrations/202609140001_cierre_caja_base.sql`
- `supabase/migrations/202609140002_security_hardening.sql`

Crean/registran la aplicación Donato, sus capacidades y las tablas:

- `donato_cierres_caja`
- `donato_cierre_retiros`
- `donato_cierre_cashback`
- `donato_cierre_cuentas_corrientes`
- `donato_cierre_ajustes`
- `donato_cierre_auditoria`

Todas las tablas tienen RLS y se validan contra acceso/capacidades de Donato.

## Estado actual

La interfaz usa el cierre de Rodrigo del 11/09/2026 como caso visual de validación. La lectura/escritura real en Sigma se conectará mediante una función server-side una vez configuradas las variables de entorno.
