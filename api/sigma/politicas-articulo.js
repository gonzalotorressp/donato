import { requireAuthenticatedUser } from '../../server/supabase-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await requireAuthenticatedUser(req))) return res.status(401).json({ error: 'Sesión requerida' });
  const id = String(req.query.id || '').trim();
  if (!/^[0-9]{1,12}$/.test(id)) return res.status(400).json({ error: 'Artículo inválido' });
  const token = process.env.SIGMA_API_TOKEN;
  if (!token) return res.status(503).json({ error: 'Falta configuración de Sigma' });
  const result = [];
  const base = 'https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api/v10/';
  const articuloUrl = new URL(base + 'ExportArticulos');
  articuloUrl.searchParams.set('id', id);
  let articulo;
  try {
    const response = await fetch(articuloUrl, { headers: { 'X-Auth-Token': token, accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const rows = await response.json();
    articulo = Array.isArray(rows) ? rows.find(row => String(row.id) === id) : null;
    if (!articulo) throw new Error('Artículo no encontrado');
  } catch (error) {
    return res.status(502).json({ error: 'No se pudo consultar el maestro del artículo para evaluar políticas', detalle: error.message });
  }
  const dimensiones = [
    ['articuloId', id, 'Artículo'],
    ['proveedorCodigo', articulo.proveedorCodigo, 'Proveedor'],
    ['rubroCodigo', articulo.rubroCodigo, 'Rubro'],
    ['grupoCodigo', articulo.grupoCodigo, 'Grupo'],
    ['divisionCodigo', articulo.divisionCodigo, 'División']
  ];
  const normalizar = value => String(value ?? '').trim().replace(/^0+(?=[0-9])/, '');
  const campos = dimensiones.map(([campo]) => campo);
  const hoy = new Date().toISOString().slice(0, 10);
  const fecha = value => {
    if (value == null || value === '') return null;
    const match = String(value).match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    return match ? match[1] : null;
  };
  let complete = false;
  try {
    for (let page = 1; page <= 10; page++) {
      const url = new URL('https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api/v10/ExportPoliticasDescuento');
      url.searchParams.set('page', String(page));
      url.searchParams.set('pagesize', '1000');
      const response = await fetch(url, { headers: { 'X-Auth-Token': token, accept: 'application/json' }, signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error('Sigma respondió HTTP ' + response.status);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Formato de políticas no reconocido');
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
      if (rows.length < 1000) { complete = true; break; }
    }
    result.sort((a, b) => (Number(a.ordenManual ?? Infinity) - Number(b.ordenManual ?? Infinity)) || (Number(a.ordenAutomatico ?? Infinity) - Number(b.ordenAutomatico ?? Infinity)));
    return res.status(200).json({ articuloId: id, politicasDirectas: result, politicasEncontradas: result, dimensionesArticulo: Object.fromEntries(dimensiones.map(([campo, valor]) => [campo, valor ?? null])), consultaCompleta: complete, fechaEvaluacion: hoy, nota: 'Evaluación preliminar: candidata no significa aplicable. Incluye coincidencias por artículo, proveedor, rubro, grupo y división, sin cliente. No incluye políticas generales sin restricciones ni otros criterios desconocidos. Las condiciones de cantidad y vigencia requieren validación antes de aplicar un precio.' });
  } catch (error) {
    return res.status(502).json({ error: 'No se pudieron consultar las políticas de Sigma', detalle: error.message });
  }
}
