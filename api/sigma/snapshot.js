import {
  buildUserSnapshot,
  compareBlindDeclaration,
  diffUserSnapshots,
  fetchTodayReports,
} from '../../server/sigma.js';
import {
  getClosureForUser,
  getDonatoCloseConfig,
  getPreviousCashboxClosure,
  getPreviousFrozenClosure,
  requireAuthenticatedUser,
  saveClosureSigmaCut,
  userHasCapability,
} from '../../server/supabase-auth.js';

function hasSnapshot(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

function carryFrom(previous, current) {
  const stored = current?.reti_conciliacion?.entrada;
  if (stored && (Array.isArray(stored.movimientosSigma) || Array.isArray(stored.gruposFisicos))) {
    return {
      movimientosSigma: Array.isArray(stored.movimientosSigma) ? stored.movimientosSigma : [],
      gruposFisicos: Array.isArray(stored.gruposFisicos) ? stored.gruposFisicos : [],
    };
  }
  const salida = previous?.reti_conciliacion?.salida;
  return {
    movimientosSigma: Array.isArray(salida?.movimientosSigma) ? salida.movimientosSigma : [],
    gruposFisicos: Array.isArray(salida?.gruposFisicos) ? salida.gruposFisicos : [],
  };
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const user = await requireAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: 'No autorizado' });
      return;
    }

    const [isEncargado, isAdmin] = await Promise.all([
      userHasCapability(request, 'donato.encargado'),
      userHasCapability(request, 'donato.admin'),
    ]);
    if (!isEncargado && !isAdmin) {
      response.status(403).json({ error: 'Los importes de Sigma sólo están disponibles para validación del Encargado Donato' });
      return;
    }

    const cierreId = typeof request.query?.cierreId === 'string' ? request.query.cierreId : '';
    if (!cierreId) {
      response.status(400).json({ error: 'Falta cierreId' });
      return;
    }

    let cierre = await getClosureForUser(request, cierreId);
    if (!cierre) {
      response.status(404).json({ error: 'Cierre no encontrado' });
      return;
    }
    if (!['PENDIENTE_VALIDACION', 'AJUSTES_AUTORIZADOS', 'AJUSTADO', 'CERRADO'].includes(cierre.estado)) {
      response.status(409).json({ error: 'El cierre todavía está en revisión del Supervisor de Caja' });
      return;
    }

    let snapshot = cierre.sigma_snapshot_tramo;
    const snapshotCajaActual = hasSnapshot(snapshot) && Number(snapshot?.cajaCodigo || 0) === Number(cierre.caja_codigo || 0);
    let anteriorCaja = await getPreviousCashboxClosure(request, cierre);

    if (!snapshotCajaActual) {
      const [[sales, accounting], anteriorUsuario] = await Promise.all([
        fetchTodayReports(cierre.fecha),
        getPreviousFrozenClosure(request, cierre),
      ]);
      anteriorCaja = await getPreviousCashboxClosure(request, cierre);
      const acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      snapshot = diffUserSnapshots(
        acumulado,
        anteriorUsuario?.sigma_snapshot_acumulado || {},
        anteriorCaja?.sigma_snapshot_acumulado || {},
      );
      const capturadoAt = cierre.corte_hasta_at || new Date().toISOString();
      cierre = await saveClosureSigmaCut(request, cierre.id, {
        sigma_snapshot_acumulado: acumulado,
        sigma_snapshot_tramo: snapshot,
        sigma_baseline_cierre_id: anteriorUsuario?.id || null,
        reti_baseline_cierre_id: anteriorCaja?.id || null,
        sigma_snapshot_capturado_at: capturadoAt,
        corte_desde_at: anteriorUsuario?.corte_hasta_at || `${cierre.fecha}T00:00:00-03:00`,
        corte_hasta_at: capturadoAt,
      });
    }

    const config = await getDonatoCloseConfig(request);
    const retiCarry = carryFrom(anteriorCaja, cierre);
    const comparison = compareBlindDeclaration(snapshot, cierre?.declaracion_ciega || {}, config || {}, retiCarry);

    const efectivoEsperadoCierre = Number(
      (Number(snapshot?.efectivo || 0) - Number(comparison.retirosDocumentados || 0)).toFixed(2),
    );
    const efectivoEntregadoCierre = Number(
      cierre?.efectivo_entregado_cierre
        ?? cierre?.declaracion_ciega?.cierreEfectivo
        ?? 0,
    );

    cierre = await saveClosureSigmaCut(request, cierre.id, {
      administrativo_ok: comparison.administrativoOk,
      reti_pendiente_entrada: comparison.retirosPendienteEntrada,
      reti_pendiente_salida: comparison.retirosPendienteSalida,
      reti_conciliacion: comparison.retiConciliacion,
      efectivo_esperado_cierre: efectivoEsperadoCierre,
      efectivo_entregado_cierre: efectivoEntregadoCierre,
    });

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      fecha: cierre.fecha,
      usuarioCodigo: cierre.usuario_sigma_codigo,
      cierreNumero: Number(cierre.cierre_nro || 1),
      corteDesde: cierre.corte_desde_at || null,
      corteHasta: cierre.corte_hasta_at || cierre.sigma_snapshot_capturado_at || null,
      snapshot,
      comparison,
      cashControl: {
        fondo_inicial: Number(cierre.fondo_inicial || 0),
        fondo_devuelto: Number(cierre.fondo_devuelto || 0),
        diferencia_fondo: Number(cierre.diferencia_fondo || 0),
        efectivo_esperado_cierre: Number(cierre.efectivo_esperado_cierre || 0),
        efectivo_entregado_cierre: Number(cierre.efectivo_entregado_cierre || 0),
        diferencia_efectivo: Number(cierre.diferencia_efectivo || 0),
      },
    });
  } catch (error) {
    console.error('Error snapshot Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
