import { requireAuthenticatedUser, userHasApplicationAccess } from '../../server/supabase-auth.js';
import { getPolicies, sigmaJson } from '../../server/policy-cache.js';
import { argentinaToday } from '../../server/sigma.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    if (!(await requireAuthenticatedUser(req))) return res.status(401).json({ error: 'Sesión requerida' });
    if (!(await userHasApplicationAccess(req, 'donato'))) return res.status(403).json({ error: 'Acceso a Donato requerido' });
    const id = String(req.query.id || '').trim();
    if (!/^[0-9]{1,12}$/.test(id)) return res.status(400).json({ error: 'Artículo inválido' });
    const token = process.env.SIGMA_API_TOKEN;
    if (!token) return res.status(503).json({ error: 'Falta configuración de Sigma' });
    if (!process.env.DONATO_POLICY_CACHE_SECRET) return res.status(503).json({ error: 'Falta configuración de caché de políticas' });
    const signal = AbortSignal.timeout(40000);
    const articleUrl = new URL('https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api/v10/ExportArticulos');
    articleUrl.searchParams.set('id', id);
    const articleRows = await sigmaJson(articleUrl, token, AbortSignal.any([signal, AbortSignal.timeout(12000)]), 'Maestro de artículos');
    const articulo = articleRows.find(row => String(row.id) === id);
    if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' });
    const snapshot = await getPolicies(req, token, String(req.query.force ?? '') === '1', signal);
    const result = [];
  const dimensiones = [
    ['articuloId', id, 'Artículo'],
    ['proveedorCodigo', articulo.proveedorCodigo, 'Proveedor'],
    ['rubroCodigo', articulo.rubroCodigo, 'Rubro'],
    ['grupoCodigo', articulo.grupoCodigo, 'Grupo'],
    ['divisionCodigo', articulo.divisionCodigo, 'División']
  ];
  const normalizar = value => String(value ?? '').trim().replace(/^0+(?=[0-9])/, '');
  const hoy = argentinaToday();
  const fecha = value => {
    if (value == null || value === '') return null;
    const match = String(value).match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    return match ? match[1] : null;
  };

    const rows = snapshot.rows;
      for (const p of rows) {
        const restricciones = dimensiones.filter(([campo]) => p[campo] != null && String(p[campo]).trim() !== '');
        if (!restricciones.length) continue;
        if (restricciones.some(([campo, valor]) => valor == null || normalizar(p[campo]) !== normalizar(valor))) continue;
        if (p.clienteId != null || p.clienteGrupoCodigo != null || p.clienteRubroCodigo != null) continue;
        if (String(p.desactivada ?? 'N').toUpperCase() === 'S') continue;
        if (p.listaPrecio != null && String(p.listaPrecio) !== '4') continue;
        if (p.empresa != null && String(p.empresa).padStart(4, '0') !== '0001') continue;
        if (p.sucursal != null && String(p.sucursal).padStart(4, '0') !== '0004') continue;
        const alcance = restricciones.map(([campo, , nombre]) => nombre);
        const desde = fecha(p.vigenciaDesde);
        const hasta = fecha(p.vigenciaHasta);
        const motivos = [];
        if (p.vigenciaDesde && !desde || p.vigenciaHasta && !hasta) motivos.push('Formato de vigencia sin validar');
        if (desde && desde > hoy) motivos.push('Todavía no vigente');
        if (hasta && hasta < hoy) motivos.push('Vencida');
        if (p.cantidadMinima != null || p.cantidadMaxima != null || String(p.cantidadEnBultos ?? 'N').toUpperCase() === 'S' || String(p.politicaPorBulto ?? 'N').toUpperCase() === 'S') motivos.push('Requiere validar cantidad y bultos');
        if (p.condicionVenta != null || p.dia != null) motivos.push('Requiere validar condición de venta o día');
        if (p.descuento == null && p.precio == null) motivos.push('Sin descuento ni precio fijo');
        result.push({
          evaluacion: motivos.length ? 'requiere_validacion' : 'candidata',
          motivosEvaluacion: motivos,
          alcance,
          restricciones: Object.fromEntries(restricciones.map(([campo]) => [campo, p[campo]])),
          id: p.id, descuento: p.descuento, precio: p.precio,
          ordenManual: p.ordenManual, ordenAutomatico: p.ordenAutomatico,
          cantidadMinima: p.cantidadMinima, cantidadMaxima: p.cantidadMaxima,
          cantidadEnBultos: p.cantidadEnBultos, politicaPorBulto: p.politicaPorBulto,
          vigenciaDesde: p.vigenciaDesde, vigenciaHasta: p.vigenciaHasta,
          condicionVenta: p.condicionVenta, dia: p.dia
        });
      }

    result.sort((a, b) => (Number(a.ordenManual ?? Infinity) - Number(b.ordenManual ?? Infinity)) || (Number(a.ordenAutomatico ?? Infinity) - Number(b.ordenAutomatico ?? Infinity)));
    return res.status(200).json({ articuloId: id, politicasDirectas: result, politicasEncontradas: result, dimensionesArticulo: Object.fromEntries(dimensiones.map(([campo, valor]) => [campo, valor ?? null])), consultaCompleta: snapshot.complete, fechaEvaluacion: hoy, cacheActualizada: new Date(snapshot.updatedAt).toISOString(), desdeCache: snapshot.cached, nota: 'Evaluación preliminar: candidata no significa aplicable. Incluye coincidencias por artículo, proveedor, rubro, grupo y división, sin cliente. No incluye políticas generales sin restricciones ni otros criterios desconocidos. Las condiciones de cantidad y vigencia requieren validación antes de aplicar un precio.' });
  } catch (error) {
    if (error.status === 503) res.setHeader('Retry-After', '3');
    const message = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'La consulta a Sigma demoró demasiado. Volvé a intentar'
      : error instanceof Error ? error.message : 'Error de consulta';
    return res.status(error.status === 503 ? 503 : 502).json({ error: 'No se pudieron consultar las políticas: ' + message });
  }
}
