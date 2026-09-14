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

## Base de datos

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
