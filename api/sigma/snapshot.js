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

function secondsFromTime(value) {
  const match = String(value || '').match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function timeFromSeconds(value) {
  const seconds = Math.max(0, Math.min(86399, Math.round(Number(value) || 0)));
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function localCutoffSeconds(value) {
  if (!value) return null;
  const explicit = String(value).match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (explicit && /-03:00$/.test(String(value))) {
    return Number(explicit[1]) * 3600 + Number(explicit[2]) * 60 + Number(explicit[3] || 0);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Cordoba',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

function rowId(row) {
  const value = Number(row?.id ?? row?.ID);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function buildRetiChronology(sales, accounting, fecha, cajaCodigo, corteHasta) {
  const cashAccount = 1259 + Number(cajaCodigo || 0);
  if (cashAccount < 1260 || cashAccount > 1263) return null;

  // Determina qué usuarios operaron esta caja mediante CODO contra la cuenta física.
  const users = new Set();
  for (const row of accounting) {
    if (row.fecha !== fecha) continue;
    if (String(row.comprobanteCodigo || '').trim().toUpperCase() !== 'CODO') continue;
    if (Number(row.cuentaCodigo) !== cashAccount) continue;
    const user = Number(row.usuarioCodigo);
    if (Number.isFinite(user)) users.add(user);
  }

  // Los VENT sí tienen secuencia contable (ID) y las ventas sí tienen hora. Para cada
  // usuario emparejamos ambas secuencias por posición. No se pretende inventar una hora
  // exacta: son anclas para interpolar el momento aproximado de un RETI.
  const anchors = [];
  for (const user of users) {
    const ventIds = [...new Set(accounting
      .filter((row) => row.fecha === fecha
        && Number(row.usuarioCodigo) === user
        && String(row.comprobanteCodigo || '').trim().toUpperCase() === 'VENT'
        && Number(row.cuentaCodigo) === 4000)
      .map(rowId)
      .filter(Boolean))].sort((a, b) => a - b);
    const saleTimes = sales
      .filter((row) => row.fecha === fecha && Number(row.usuario) === user)
      .map((row) => secondsFromTime(row.hora))
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    if (!ventIds.length || !saleTimes.length) continue;

    const count = Math.min(ventIds.length, saleTimes.length);
    for (let index = 0; index < count; index += 1) {
      const ventIndex = count === 1 ? 0 : Math.round(index * (ventIds.length - 1) / (count - 1));
      const saleIndex = count === 1 ? 0 : Math.round(index * (saleTimes.length - 1) / (count - 1));
      anchors.push({ id: ventIds[ventIndex], seconds: saleTimes[saleIndex], user });
    }
  }
  anchors.sort((a, b) => a.id - b.id);
  if (!anchors.length) return null;

  const retiros = accounting
    .filter((row) => row.fecha === fecha
      && String(row.comprobanteCodigo || '').trim().toUpperCase() === 'RETI'
      && Number(row.cuentaCodigo) === cashAccount
      && rowId(row))
    .map((row) => {
      const id = rowId(row);
      let before = null;
      let after = null;
      for (const anchor of anchors) {
        if (anchor.id <= id) before = anchor;
        if (anchor.id >= id) { after = anchor; break; }
      }
      let estimated = null;
      let confidence = 'BAJA';
      if (before && after && before.id !== after.id) {
        const ratio = (id - before.id) / (after.id - before.id);
        estimated = before.seconds + ratio * (after.seconds - before.seconds);
        confidence = 'ALTA';
      } else if (before && after) {
        estimated = before.seconds;
        confidence = 'ALTA';
      } else if (before) {
        estimated = before.seconds;
        confidence = 'MEDIA';
      } else if (after) {
        estimated = after.seconds;
        confidence = 'MEDIA';
      }
      const importe = Math.abs(Number(row.monto || row.haber || row.debe || 0));
      return {
        key: `reti-id-${id}`,
        id,
        cuentaCodigo: cashAccount,
        usuarioCodigo: Number(row.usuarioCodigo) || null,
        usuarioNombre: String(row.usuarioNombre || '').trim(),
        importe: Math.round((importe + Number.EPSILON) * 100) / 100,
        concepto: String(row.concepto || '').trim(),
        observacion: String(row.observacion || '').trim(),
        horaAproximada: estimated === null ? null : timeFromSeconds(estimated),
        horaAproximadaSegundos: estimated === null ? null : Math.round(estimated),
        confianzaHora: confidence,
        criterioHora: 'INTERPOLACION_ID_CONTABLE_VS_HORA_VENTA',
        anclaAnteriorId: before?.id || null,
        anclaPosteriorId: after?.id || null,
      };
    })
    .sort((a, b) => a.id - b.id);

  const cutoff = localCutoffSeconds(corteHasta);
  const incluidos = cutoff === null
    ? retiros
    : retiros.filter((row) => row.horaAproximadaSegundos === null || row.horaAproximadaSegundos <= cutoff);

  return {
    cashAccount,
    cutoff,
    anchors: anchors.length,
    retiros,
    incluidos,
  };
}

function applyRetiChronology(snapshot, sales, accounting, cierre) {
  const chronology = buildRetiChronology(
    sales,
    accounting,
    cierre.fecha,
    cierre.caja_codigo,
    cierre.corte_hasta_at || cierre.sigma_snapshot_capturado_at || null,
  );
  if (!chronology) return snapshot;
  const result = { ...snapshot };
  result.retirosDocumentos = chronology.incluidos;
  result.retiros = Math.round((chronology.incluidos.reduce((sum, row) => sum + Number(row.importe || 0), 0) + Number.EPSILON) * 100) / 100;
  result.retiCronologia = {
    criterio: 'INTERPOLACION_ID_CONTABLE_VS_HORA_VENTA',
    anclas: chronology.anchors,
    corteHora: chronology.cutoff === null ? null : timeFromSeconds(chronology.cutoff),
    movimientosCaja: chronology.retiros.length,
    movimientosIncluidos: chronology.incluidos.length,
  };
  return result;
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
      let acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      acumulado = applyRetiChronology(acumulado, sales, accounting, cierre);
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
      (Number(snapshot?.efectivo || 0) - Number(comparison.totalDepositario || 0) - Number(comparison.totalSupervisor || 0)).toFixed(2),
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
