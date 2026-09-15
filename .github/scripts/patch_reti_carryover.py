from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Pattern not found: {label}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# server/sigma.js: RETI se concilia por movimientos completos, nunca por saldo.
# -----------------------------------------------------------------------------
p = Path('server/sigma.js')
s = p.read_text()
start = s.index('function retiroMovementDifference(')
end = s.index('export function diffUserSnapshots', start)
new_diff_helper = r'''function retiroMovementDifference(currentRows, baselineRows) {
  const currentByKey = new Map();
  const baselineByKey = new Map();

  for (const row of Array.isArray(currentRows) ? currentRows : []) {
    const key = String(row?.key || '');
    const current = currentByKey.get(key);
    currentByKey.set(key, current
      ? { ...current, importe: round2(number(current.importe) + number(row?.importe)) }
      : { ...row, key, importe: round2(row?.importe) });
  }
  for (const row of Array.isArray(baselineRows) ? baselineRows : []) {
    const key = String(row?.key || '');
    baselineByKey.set(key, round2(number(baselineByKey.get(key)) + number(row?.importe)));
  }

  const keys = new Set([...currentByKey.keys(), ...baselineByKey.keys()]);
  const result = [];
  for (const key of keys) {
    const current = currentByKey.get(key);
    const currentAmount = round2(current?.importe);
    const baselineAmount = round2(baselineByKey.get(key));
    const delta = round2(currentAmount - baselineAmount);
    if (Math.abs(delta) <= 0.005) continue;
    result.push({
      ...(current || { key }),
      key,
      importe: delta,
      esDeltaInferido: Math.abs(baselineAmount) > 0.005,
      importeAcumuladoAnterior: baselineAmount,
      importeAcumuladoActual: currentAmount,
    });
  }
  result.sort((a, b) => Math.abs(number(b.importe)) - Math.abs(number(a.importe)) || String(a.key).localeCompare(String(b.key)));
  return result;
}

'''
s = s[:start] + new_diff_helper + s[end:]

start = s.index('function sumRows(rows) {')
new_tail = r'''function sumRows(rows) {
  if (!Array.isArray(rows)) return 0;
  return round2(rows.reduce((sum, row) => sum + number(row?.importe), 0));
}

function retiMovementAmount(rows) {
  return round2((Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + Math.abs(number(row?.importe)), 0));
}

function cloneRetiRows(rows, origen) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => Math.abs(number(row?.importe)) > 0.005)
    .map((row, index) => ({
      ...row,
      key: String(row?.key || `${origen}-${index}-${Math.abs(number(row?.importe))}`),
      importe: round2(Math.abs(number(row?.importe))),
      origen: row?.origen || origen,
    }));
}

function physicalRetiGroup(declaration) {
  const documentos = [
    ...(Array.isArray(declaration?.depositario) ? declaration.depositario : [])
      .filter((row) => number(row?.importe) > 0)
      .map((row) => ({
        tipo: 'depositario',
        referencia: String(row?.referencia || '').trim(),
        importe: round2(row?.importe),
      })),
    ...(Array.isArray(declaration?.retirosSupervisor) ? declaration.retirosSupervisor : [])
      .filter((row) => number(row?.importe) > 0)
      .map((row) => ({
        tipo: 'supervisor',
        referencia: String(row?.referencia || '').trim(),
        importe: round2(row?.importe),
      })),
  ];
  return {
    key: 'cierre-actual',
    origen: 'cierre_actual',
    total: round2(documentos.reduce((sum, row) => sum + number(row.importe), 0)),
    documentos,
  };
}

function findMovementSubset(rows, target, tolerance) {
  const targetCents = Math.round(number(target) * 100);
  const toleranceCents = Math.max(1, Math.round(Math.max(0, number(tolerance)) * 100));
  if (Math.abs(targetCents) <= toleranceCents) return [];

  const candidates = rows
    .map((row, index) => ({ index, cents: Math.round(Math.abs(number(row?.importe)) * 100) }))
    .filter((item) => item.cents > 0);
  const states = new Map([[0, []]]);

  for (const candidate of candidates) {
    const snapshot = [...states.entries()];
    for (const [sum, indexes] of snapshot) {
      const next = sum + candidate.cents;
      if (next > targetCents + toleranceCents) continue;
      const path = [...indexes, candidate.index];
      if (Math.abs(next - targetCents) <= toleranceCents) return path;
      if (!states.has(next)) states.set(next, path);
    }
  }
  return null;
}

function reconcileRetiMovements(snapshot, declaration, carry = {}, tolerance = 0.01) {
  const sigmaEntrada = cloneRetiRows(carry?.movimientosSigma, 'pendiente_anterior');
  const fisicoEntrada = (Array.isArray(carry?.gruposFisicos) ? carry.gruposFisicos : [])
    .filter((group) => number(group?.total) > 0)
    .map((group, index) => ({
      ...group,
      key: String(group?.key || `fisico-anterior-${index}`),
      origen: group?.origen || 'pendiente_anterior',
      total: round2(group?.total),
    }));

  let nuevosSigma = cloneRetiRows(snapshot?.retirosDocumentos, 'sigma_tramo');
  if (!nuevosSigma.length && Math.abs(number(snapshot?.retiros)) > 0.005) {
    nuevosSigma = [{
      key: 'sigma-total-sin-detalle',
      origen: 'sigma_tramo',
      importe: round2(Math.abs(number(snapshot?.retiros))),
      usuarioNombre: 'Sigma',
      concepto: 'RETI acumulado del corte (sin detalle individual guardado)',
      sintetico: true,
    }];
  }

  const grupoActual = physicalRetiGroup(declaration);
  const grupos = [...fisicoEntrada];
  if (grupoActual.total > 0.005) grupos.push(grupoActual);

  const disponibles = [...sigmaEntrada, ...nuevosSigma];
  const restantes = disponibles.map((row) => ({ ...row }));
  const conciliados = [];
  const fisicoPendiente = [];

  for (const group of grupos) {
    const subset = findMovementSubset(restantes, group.total, tolerance);
    if (subset === null) {
      fisicoPendiente.push(group);
      continue;
    }
    const matched = subset.map((index) => restantes[index]);
    conciliados.push({ grupoFisico: group, movimientosSigma: matched });
    for (const index of [...subset].sort((a, b) => b - a)) restantes.splice(index, 1);
  }

  const currentMatched = grupoActual.total <= 0.005 || conciliados.some((item) => item.grupoFisico?.key === 'cierre-actual');
  const errorRegistro = restantes.length > 0 && fisicoPendiente.length > 0;

  // Si hay movimientos en ambos lados pero no existe una combinación exacta, no se
  // reparte la diferencia ni se arrastra: queda como error de registración de este cierre.
  const sigmaSalida = errorRegistro ? [] : restantes;
  const fisicoSalida = errorRegistro ? [] : fisicoPendiente;
  const estado = errorRegistro
    ? 'ERROR_REGISTRO'
    : (sigmaSalida.length || fisicoSalida.length ? 'PENDIENTE' : 'CONCILIADO');

  return {
    estado,
    errorRegistro,
    currentMatched,
    entrada: {
      movimientosSigma: sigmaEntrada,
      gruposFisicos: fisicoEntrada,
    },
    nuevosSigma,
    grupoFisicoActual: grupoActual,
    movimientosSigmaDisponibles: disponibles,
    conciliados,
    salida: {
      movimientosSigma: sigmaSalida,
      gruposFisicos: fisicoSalida,
    },
    movimientosSigmaError: errorRegistro ? restantes : [],
    gruposFisicosError: errorRegistro ? fisicoPendiente : [],
    sigmaPendienteEntrada: retiMovementAmount(sigmaEntrada),
    fisicoPendienteEntrada: round2(fisicoEntrada.reduce((sum, group) => sum + number(group.total), 0)),
    sigmaPendienteSalida: retiMovementAmount(sigmaSalida),
    fisicoPendienteSalida: round2(fisicoSalida.reduce((sum, group) => sum + number(group.total), 0)),
  };
}

export function compareBlindDeclaration(snapshot, declaration, config = {}, retiCarry = {}) {
  const toleranciaConceptos = Math.max(0, number(config.tolerancia_conceptos ?? 0.01));
  const toleranciaCaja = Math.max(0, number(config.tolerancia_caja ?? 0.01));

  const cloverFisico = round2(declaration?.cloverFisico);
  const paywayFisico = round2(declaration?.paywayFisico);
  const cierreEfectivo = round2(declaration?.cierreEfectivo);
  const totalDepositario = sumRows(declaration?.depositario);
  const totalSupervisor = sumRows(declaration?.retirosSupervisor);
  const totalCashback = sumRows(declaration?.cashbacks);
  const totalCuentaCorriente = Array.isArray(declaration?.cuentasCorrientes)
    ? round2(declaration.cuentasCorrientes.reduce((sum, row) => sum + number(row?.importe), 0))
    : 0;

  const retirosDocumentados = round2(totalDepositario + totalSupervisor);
  const efectivoRendido = round2(retirosDocumentados + cierreEfectivo);
  const cloverSigma = round2(number(snapshot?.cloverDirecto) + number(snapshot?.naranja));
  const paywaySigma = round2(snapshot?.payway);
  const cuentaCorrienteSigma = round2(snapshot?.cuentaCorriente);
  const retiConciliacion = reconcileRetiMovements(snapshot, declaration, retiCarry, toleranciaConceptos);

  const diferencias = {
    clover: round2(cloverFisico - cloverSigma),
    payway: round2(paywayFisico - paywaySigma),
    // Cero sólo significa que el físico del cierre encontró una combinación exacta.
    // Nunca se calcula una coincidencia parcial de un movimiento Sigma.
    retiros: retiConciliacion.currentMatched ? 0 : round2(retirosDocumentados - number(snapshot?.retiros)),
    cuentaCorriente: round2(totalCuentaCorriente - cuentaCorrienteSigma),
  };

  const totalFisicoControlado = round2(efectivoRendido + cloverFisico + paywayFisico + totalCuentaCorriente);
  const totalSigmaControlado = round2(
    number(snapshot?.efectivo) + cloverSigma + paywaySigma + cuentaCorrienteSigma
  );
  const diferenciaCaja = round2(totalFisicoControlado - totalSigmaControlado);

  const coincidencias = {
    clover: Math.abs(diferencias.clover) <= toleranciaConceptos,
    payway: Math.abs(diferencias.payway) <= toleranciaConceptos,
    retiros: retiConciliacion.estado === 'CONCILIADO',
    cuentaCorriente: Math.abs(diferencias.cuentaCorriente) <= toleranciaConceptos,
  };

  const conceptosOk = coincidencias.clover && coincidencias.payway && coincidencias.cuentaCorriente;
  const administrativoOk = retiConciliacion.estado === 'CONCILIADO';
  const hayPendienteAdministrativo = retiConciliacion.estado === 'PENDIENTE';
  const errorRegistroAdministrativo = retiConciliacion.estado === 'ERROR_REGISTRO';
  const cajaOk = Math.abs(diferenciaCaja) <= toleranciaCaja;
  const retirosPendienteEntrada = round2(retiConciliacion.sigmaPendienteEntrada - retiConciliacion.fisicoPendienteEntrada);
  const retirosPendienteSalida = round2(retiConciliacion.sigmaPendienteSalida - retiConciliacion.fisicoPendienteSalida);

  return {
    coincidencias,
    conceptosOk,
    administrativoOk,
    administrativoEstado: retiConciliacion.estado,
    hayPendienteAdministrativo,
    errorRegistroAdministrativo,
    cajaOk,
    // Un movimiento entero pendiente puede pasar al próximo cierre. Una incompatibilidad
    // entre movimientos completos sí es una diferencia que requiere revisión.
    hayDiferencias: !conceptosOk || !cajaOk || errorRegistroAdministrativo,
    diferencias,
    diferenciaCaja,
    totalFisicoControlado,
    totalSigmaControlado,
    retirosDocumentados,
    retirosPendienteEntrada,
    retirosPendienteSalida,
    retirosSigmaPendienteSalida: retiConciliacion.sigmaPendienteSalida,
    retirosFisicoPendienteSalida: retiConciliacion.fisicoPendienteSalida,
    retiConciliacion,
    totalDepositario,
    totalSupervisor,
    cierreEfectivo,
    totalCashback,
    toleranciaConceptos,
    toleranciaCaja,
  };
}
'''
s = s[:start] + new_tail
p.write_text(s)

# -----------------------------------------------------------------------------
# server/supabase-auth.js: traer conciliación completa del cierre anterior de caja.
# -----------------------------------------------------------------------------
p = Path('server/supabase-auth.js')
s = p.read_text()
s = replace_once(s,
"""  url.searchParams.set('corte_hasta_at', 'not.is.null');
  url.searchParams.set('select', 'id,corte_hasta_at,sigma_snapshot_acumulado,reti_pendiente_salida');""",
"""  if (cierre.corte_hasta_at) url.searchParams.set('corte_hasta_at', `lt.${cierre.corte_hasta_at}`);
  else url.searchParams.set('corte_hasta_at', 'not.is.null');
  url.searchParams.set('select', 'id,corte_hasta_at,sigma_snapshot_acumulado,reti_pendiente_salida,reti_conciliacion');""",
'previous cashbox select')
p.write_text(s)

# -----------------------------------------------------------------------------
# APIs: persistir listas completas pendientes/conciliadas.
# -----------------------------------------------------------------------------
api_common = r'''function carryFrom(previous, current) {
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
'''

Path('api/sigma/comparar.js').write_text(r'''import {
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

''' + api_common + r'''
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
''')

Path('api/sigma/snapshot.js').write_text(r'''import {
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

''' + api_common + r'''
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

    cierre = await saveClosureSigmaCut(request, cierre.id, {
      administrativo_ok: comparison.administrativoOk,
      reti_pendiente_entrada: comparison.retirosPendienteEntrada,
      reti_pendiente_salida: comparison.retirosPendienteSalida,
      reti_conciliacion: comparison.retiConciliacion,
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
    });
  } catch (error) {
    console.error('Error snapshot Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
''')

# -----------------------------------------------------------------------------
# UI: distinguir PENDIENTE de ERROR_REGISTRO y mostrar movimientos completos.
# -----------------------------------------------------------------------------
p = Path('src/App.tsx')
s = p.read_text()
s = replace_once(s,
"""  hayPendienteAdministrativo?: boolean;
  avisos?: { comprobantePendiente?: boolean; pendienteAdministrativo?: boolean };""",
"""  hayPendienteAdministrativo?: boolean;
  errorRegistroAdministrativo?: boolean;
  administrativoEstado?: 'CONCILIADO' | 'PENDIENTE' | 'ERROR_REGISTRO';
  avisos?: { comprobantePendiente?: boolean; pendienteAdministrativo?: boolean; errorRegistroAdministrativo?: boolean };""",
'blind admin status type')
s = replace_once(s,
"""  hayPendienteAdministrativo?: boolean;
  retirosDocumentados?: number;
  retirosPendienteEntrada?: number;
  retirosPendienteSalida?: number;""",
"""  hayPendienteAdministrativo?: boolean;
  errorRegistroAdministrativo?: boolean;
  administrativoEstado?: 'CONCILIADO' | 'PENDIENTE' | 'ERROR_REGISTRO';
  retirosDocumentados?: number;
  retirosPendienteEntrada?: number;
  retirosPendienteSalida?: number;
  retirosSigmaPendienteSalida?: number;
  retirosFisicoPendienteSalida?: number;
  retiConciliacion?: any;""",
'full admin status type')
s = replace_once(s,
"""function comparisonMessage(result: BlindComparison) {
  if (result.conceptosOk && result.cajaOk && result.hayPendienteAdministrativo) return 'La caja y los medios coinciden. Queda un movimiento administrativo pendiente para el próximo cierre de esta caja.';""",
"""function comparisonMessage(result: BlindComparison) {
  if (result.errorRegistroAdministrativo) return 'La caja puede coincidir, pero RETI tiene un error de registración: ningún movimiento o combinación completa coincide con lo informado físicamente.';
  if (result.conceptosOk && result.cajaOk && result.hayPendienteAdministrativo) return 'La caja y los medios coinciden. Quedan movimientos completos pendientes para el próximo cierre de esta caja.';""",
'comparison admin message')
s = replace_once(s,
"""      { label: 'Control administrativo RETI', ok: result.coincidencias.retiros, detail: result.coincidencias.retiros ? 'Documentación conciliada con Sigma' : 'Queda pendiente para el próximo cierre de esta caja; no bloquea si caja y medios están OK' },""",
"""      { label: 'Control administrativo RETI', ok: result.coincidencias.retiros, detail: result.errorRegistroAdministrativo ? 'Error de registración: no existe un movimiento o combinación completa que coincida con lo físico' : result.hayPendienteAdministrativo ? 'Hay movimientos completos pendientes para el próximo cierre de esta caja' : 'Documentación conciliada con Sigma' },""",
'review admin row')

old = """                <div className=\"compare-row reti-compare-row\"><div><span>RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Movimientos nuevos de la caja desde el último corte de esa misma caja.</small>{Number(fullComparison.retirosPendienteEntrada || 0) !== 0 ? <small className=\"reti-carry-note\">Pendiente anterior: {money.format(Math.abs(Number(fullComparison.retirosPendienteEntrada || 0)))} · {Number(fullComparison.retirosPendienteEntrada || 0) > 0 ? 'Sigma pendiente de documentación' : 'documentación pendiente de Sigma'}</small> : null}{snapshot.retirosDocumentos?.length ? <div className=\"reti-detail-list\">{snapshot.retirosDocumentos.map((retiro, index) => <div className=\"reti-detail-item\" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className=\"reti-detail-empty\">Sin detalle adicional para este corte.</small>}</div><div className=\"compare-arrow\">→</div><div><span>Documentación física del cierre</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong><small className={fullComparison.coincidencias.retiros ? 'positive' : 'negative'}>{fullComparison.coincidencias.retiros ? 'Conciliado' : `${money.format(Math.abs(Number(fullComparison.retirosPendienteSalida || 0)))} queda pendiente para el próximo cierre de Caja ${closure.caja_codigo}`}</small>{!fullComparison.coincidencias.retiros ? <small>{Number(fullComparison.retirosPendienteSalida || 0) > 0 ? 'Sigma tiene RETI pendiente de documentación física.' : 'Hay documentación física pendiente de registrarse como RETI en Sigma.'}</small> : null}</div></div>"""
new = """                <div className=\"compare-row reti-compare-row\"><div><span>Movimientos RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Se concilian movimientos completos; nunca se parte un RETI para hacer coincidir un saldo.</small>{snapshot.retirosDocumentos?.length ? <div className=\"reti-detail-list\">{snapshot.retirosDocumentos.map((retiro: any, index) => <div className=\"reti-detail-item\" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.esDeltaInferido ? <small>Incremento detectado desde el corte anterior</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className=\"reti-detail-empty\">Sin detalle individual guardado para este corte.</small>}</div><div className=\"compare-arrow\">→</div><div><span>Documentación física del cierre</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong>{fullComparison.errorRegistroAdministrativo ? <><small className=\"negative\">Error de registración Sigma</small><small>No existe un movimiento o combinación completa que coincida con el importe físico. No se divide la diferencia.</small></> : fullComparison.hayPendienteAdministrativo ? <><small className=\"negative\">Pendiente administrativo</small><small>{fullComparison.retirosSigmaPendienteSalida ? `${money.format(fullComparison.retirosSigmaPendienteSalida)} en movimientos Sigma completos quedan para el próximo cierre.` : `${money.format(fullComparison.retirosFisicoPendienteSalida || 0)} de documentación física espera su RETI en Sigma.`}</small></> : <small className=\"positive\">Conciliado por movimientos completos</small>}</div></div>"""
s = replace_once(s, old, new, 'approver whole movement row')
p.write_text(s)

# -----------------------------------------------------------------------------
# PDF: dejar explícito que no se parten movimientos.
# -----------------------------------------------------------------------------
p = Path('src/lib/closurePdf.ts')
s = p.read_text()
s = replace_once(s,
"""  pair('Control administrativo RETI', adminOk ? 'OK' : 'PENDIENTE PARA PROXIMO CIERRE');""",
"""  const adminStatus = fullComparison?.errorRegistroAdministrativo
    ? 'ERROR DE REGISTRACION SIGMA'
    : fullComparison?.hayPendienteAdministrativo
      ? 'PENDIENTE PARA PROXIMO CIERRE'
      : adminOk ? 'OK' : 'REVISAR';
  pair('Control administrativo RETI', adminStatus);""",
'pdf admin status')
s = replace_once(s,
"""    if (num(fullComparison.retirosPendienteEntrada)) {
      pair('Pendiente RETI recibido del cierre anterior', pesos.format(Math.abs(num(fullComparison.retirosPendienteEntrada))));
    }
    if (num(fullComparison.retirosPendienteSalida)) {
      const sentido = num(fullComparison.retirosPendienteSalida) > 0
        ? 'Sigma pendiente de documentacion fisica'
        : 'Documentacion fisica pendiente de Sigma';
      pair('Pendiente RETI para proximo cierre', pesos.format(Math.abs(num(fullComparison.retirosPendienteSalida))), 'Sentido', sentido);
    }""",
"""    if (fullComparison.errorRegistroAdministrativo) {
      pair('RETI', 'ERROR: no existe movimiento o combinacion completa que coincida con el fisico');
    } else if (fullComparison.hayPendienteAdministrativo) {
      if (num(fullComparison.retirosSigmaPendienteSalida)) pair('Movimientos Sigma pendientes', pesos.format(num(fullComparison.retirosSigmaPendienteSalida)));
      if (num(fullComparison.retirosFisicoPendienteSalida)) pair('Documentacion fisica pendiente', pesos.format(num(fullComparison.retirosFisicoPendienteSalida)));
    }""",
'pdf pending detail')
p.write_text(s)
