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
} from '../../server/supabase-auth.js';

function hasSnapshot(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const user = await requireAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: 'No autorizado' });
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
    if (!cierre.carga_ciega_cerrada_at) {
      response.status(409).json({ error: 'Primero hay que cerrar la caja' });
      return;
    }

    let snapshotTramo = cierre.sigma_snapshot_tramo;
    const snapshotCajaActual = hasSnapshot(snapshotTramo) && Number(snapshotTramo?.cajaCodigo || 0) === Number(cierre.caja_codigo || 0);
    if (!snapshotCajaActual) {
      const [[sales, accounting], anterior] = await Promise.all([
        fetchTodayReports(cierre.fecha),
        getPreviousFrozenClosure(request, cierre),
      ]);

      const acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      const baseline = anterior?.sigma_snapshot_acumulado || {};
      snapshotTramo = diffUserSnapshots(acumulado, baseline);
      const capturadoAt = new Date().toISOString();
      const corteDesde = anterior?.corte_hasta_at || `${cierre.fecha}T00:00:00-03:00`;

      cierre = await saveClosureSigmaCut(request, cierre.id, {
        sigma_snapshot_acumulado: acumulado,
        sigma_snapshot_tramo: snapshotTramo,
        sigma_baseline_cierre_id: anterior?.id || null,
        sigma_snapshot_capturado_at: capturadoAt,
        corte_desde_at: corteDesde,
        corte_hasta_at: capturadoAt,
        venta_sigma: snapshotTramo.venta || 0,
        efectivo_sigma: snapshotTramo.efectivo || 0,
        clover_sigma: snapshotTramo.cloverDirecto || 0,
        payway_sigma: snapshotTramo.payway || 0,
        naranja_sigma: snapshotTramo.naranja || 0,
        retiros_sigma: snapshotTramo.retiros || 0,
        cuenta_corriente_sigma: snapshotTramo.cuentaCorriente || 0,
      });
    }

    const config = await getDonatoCloseConfig(request);
    const comparison = compareBlindDeclaration(snapshotTramo, cierre?.declaracion_ciega || {}, config || {});

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      resultado: {
        coincidencias: comparison.coincidencias,
        conceptosOk: comparison.conceptosOk,
        administrativoOk: comparison.administrativoOk,
        cajaOk: comparison.cajaOk,
        hayDiferencias: comparison.hayDiferencias,
        avisos: {
          comprobantePendiente: Number(snapshotTramo?.pendienteContado || 0) > Number(config?.tolerancia_conceptos ?? 0.01),
        },
      },
      cierreNumero: Number(cierre?.cierre_nro || 1),
    });
  } catch (error) {
    console.error('Error comparación ciega Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error comparando con Sigma' });
  }
}
