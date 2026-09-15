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
    let anteriorCaja = await getPreviousCashboxClosure(request, cierre);

    if (!snapshotCajaActual) {
      const [[sales, accounting], anteriorUsuario] = await Promise.all([
        fetchTodayReports(cierre.fecha),
        getPreviousFrozenClosure(request, cierre),
      ]);
      anteriorCaja = await getPreviousCashboxClosure(request, cierre);
      const acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      snapshotTramo = diffUserSnapshots(
        acumulado,
        anteriorUsuario?.sigma_snapshot_acumulado || {},
        anteriorCaja?.sigma_snapshot_acumulado || {},
      );
      const capturadoAt = new Date().toISOString();
      const corteDesde = anteriorUsuario?.corte_hasta_at || `${cierre.fecha}T00:00:00-03:00`;

      cierre = await saveClosureSigmaCut(request, cierre.id, {
        sigma_snapshot_acumulado: acumulado,
        sigma_snapshot_tramo: snapshotTramo,
        sigma_baseline_cierre_id: anteriorUsuario?.id || null,
        reti_baseline_cierre_id: anteriorCaja?.id || null,
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
    const retiCarry = carryFrom(anteriorCaja, cierre);
    const comparison = compareBlindDeclaration(snapshotTramo, cierre?.declaracion_ciega || {}, config || {}, retiCarry);

    cierre = await saveClosureSigmaCut(request, cierre.id, {
      administrativo_ok: comparison.administrativoOk,
      reti_pendiente_entrada: comparison.retirosPendienteEntrada,
      reti_pendiente_salida: comparison.retirosPendienteSalida,
      reti_conciliacion: comparison.retiConciliacion,
    });

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      resultado: {
        coincidencias: comparison.coincidencias,
        conceptosOk: comparison.conceptosOk,
        administrativoOk: comparison.administrativoOk,
        administrativoEstado: comparison.administrativoEstado,
        cajaOk: comparison.cajaOk,
        hayDiferencias: comparison.hayDiferencias,
        hayPendienteAdministrativo: comparison.hayPendienteAdministrativo,
        errorRegistroAdministrativo: comparison.errorRegistroAdministrativo,
        avisos: {
          comprobantePendiente: Number(snapshotTramo?.pendienteContado || 0) > Number(config?.tolerancia_conceptos ?? 0.01),
          pendienteAdministrativo: comparison.hayPendienteAdministrativo,
          errorRegistroAdministrativo: comparison.errorRegistroAdministrativo,
        },
      },
      cierreNumero: Number(cierre?.cierre_nro || 1),
    });
  } catch (error) {
    console.error('Error comparación ciega Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error comparando con Sigma' });
  }
}
