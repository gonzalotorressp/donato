import {
  buildUserSnapshot,
  compareBlindDeclaration,
  diffUserSnapshots,
  fetchTodayReports,
} from '../../server/sigma.js';
import {
  getClosureForUser,
  getDonatoCloseConfig,
  getPreviousFrozenClosure,
  requireAuthenticatedUser,
  saveClosureSigmaCut,
  userHasCapability,
} from '../../server/supabase-auth.js';

function hasSnapshot(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
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
    if (!snapshotCajaActual) {
      // Compatibilidad con cierres creados antes de incorporar jornadas partidas.
      const [[sales, accounting], anterior] = await Promise.all([
        fetchTodayReports(cierre.fecha),
        getPreviousFrozenClosure(request, cierre),
      ]);
      const acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      snapshot = diffUserSnapshots(acumulado, anterior?.sigma_snapshot_acumulado || {});
      const capturadoAt = cierre.corte_hasta_at || new Date().toISOString();
      cierre = await saveClosureSigmaCut(request, cierre.id, {
        sigma_snapshot_acumulado: acumulado,
        sigma_snapshot_tramo: snapshot,
        sigma_baseline_cierre_id: anterior?.id || null,
        sigma_snapshot_capturado_at: capturadoAt,
        corte_desde_at: anterior?.corte_hasta_at || `${cierre.fecha}T00:00:00-03:00`,
        corte_hasta_at: capturadoAt,
      });
    }

    const config = await getDonatoCloseConfig(request);
    const comparison = compareBlindDeclaration(snapshot, cierre?.declaracion_ciega || {}, config || {});

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      fecha: cierre.fecha,
      usuarioCodigo: cierre.usuario_sigma_codigo,
      cierreNumero: Number(cierre.cierre_nro || 1),
      corteDesde: cierre.corte_desde_at || null,
      corteHasta: cierre.corte_hasta_at || cierre.sigma_snapshot_capturado_at || null,
      snapshot,
      comparison,
    });
  } catch (error) {
    console.error('Error snapshot Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
