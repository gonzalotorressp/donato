import { requireAuthenticatedUser } from '../../server/supabase-auth.js';

const policyCache = { rows: null, expires: 0, pending: null };
async function loadPolicyRows(token) {
  if (policyCache.rows && Date.now() < policyCache.expires) return policyCache.rows;
  if (policyCache.pending) return policyCache.pending;
  policyCache.pending = (async () => {
    const all = [];
    let complete = false;
    const policyData = await loadPolicyRows(token);
    complete = policyData.complete;
    {
      const rows = policyData.rows;
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
    }
    result.sort((a, b) => (Number(a.ordenManual ?? Infinity) - Number(b.ordenManual ?? Infinity)) || (Number(a.ordenAutomatico ?? Infinity) - Number(b.ordenAutomatico ?? Infinity)));
    return res.status(200).json({ articuloId: id, politicasDirectas: result, politicasEncontradas: result, dimensionesArticulo: Object.fromEntries(dimensiones.map(([campo, valor]) => [campo, valor ?? null])), consultaCompleta: complete, fechaEvaluacion: hoy, nota: 'Evaluación preliminar: candidata no significa aplicable. Incluye coincidencias por artículo, proveedor, rubro, grupo y división, sin cliente. No incluye políticas generales sin restricciones ni otros criterios desconocidos. Las condiciones de cantidad y vigencia requieren validación antes de aplicar un precio.' });
  } catch (error) {
    return res.status(error?.status === 429 ? 429 : 502).json({ error: 'No se pudieron consultar las políticas de Sigma: ' + (error instanceof Error ? error.message : String(error)) });
  }
}
