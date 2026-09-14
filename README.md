# Donato

Plataforma operativa de Donato. Primer módulo: **Cierre de Caja**.

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

## Roles

- `supervisor_caja`: carga y presenta cierres.
- `encargado_donato`: valida diferencias y autoriza ajustes.
- `administrador`: acceso completo.

## Variables Vercel

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SIGMA_API_TOKEN=
SIGMA_BASE_URL=https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api
```

`SIGMA_API_TOKEN` es sólo de servidor y nunca debe exponerse con prefijo `VITE_`.

## Base de datos

La migración inicial está en:

`supabase/migrations/202609140001_cierre_caja_base.sql`

Crea perfiles, cierres, retiros, cuentas corrientes, ajustes y auditoría.

## Estado actual

La interfaz usa el cierre de Rodrigo del 11/09/2026 como caso visual de validación. La lectura/escritura real en Sigma se conectará mediante una función server-side una vez configuradas las variables de entorno.
