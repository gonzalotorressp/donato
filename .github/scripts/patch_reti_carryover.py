from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Pattern not found: {label}')
    return text.replace(old, new, 1)

# server/sigma.js
p = Path('server/sigma.js')
s = p.read_text()
s = replace_once(s,
"""        key: [
          Number(row.cuentaCodigo) || '',
          Number(row.usuarioCodigo) || '',
          retiroImporte,
          String(row.concepto || '').trim(),
          String(row.observacion || '').trim(),
        ].join('|'),""",
"""        key: [
          Number(row.cuentaCodigo) || '',
          Number(row.usuarioCodigo) || '',
          String(row.concepto || '').trim(),
          String(row.observacion || '').trim(),
        ].join('|'),""",
'reti key')

marker = """export function diffUserSnapshots(currentSnapshot, baselineSnapshot = {}) {"""
insert = """function retiroMovementDifference(currentRows, baselineRows) {
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
    const delta = round2(number(current?.importe) - number(baselineByKey.get(key)));
    if (Math.abs(delta) <= 0.005) continue;
    result.push({
      ...(current || { key }),
      key,
      importe: delta,
    });
  }
  result.sort((a, b) => Math.abs(number(b.importe)) - Math.abs(number(a.importe)) || String(a.key).localeCompare(String(b.key)));
  return result;
}

export function diffUserSnapshots(currentSnapshot, baselineSnapshot = {}, cashboxBaselineSnapshot = baselineSnapshot) {"""
s = replace_once(s, marker, insert, 'diff signature')
s = replace_once(s,
"""    retirosDocumentos: documentDifference(current.retirosDocumentos, baseline.retirosDocumentos),""",
"""    retirosDocumentos: retiroMovementDifference(current.retirosDocumentos, cashboxBaselineSnapshot?.retirosDocumentos),""",
'reti docs diff')
s = replace_once(s,
"""  for (const field of SNAPSHOT_NUMERIC_FIELDS) {
    result[field] = round2(number(current[field]) - number(baseline[field]));
  }""",
"""  for (const field of SNAPSHOT_NUMERIC_FIELDS) {
    const fieldBaseline = field === 'retiros' ? cashboxBaselineSnapshot : baseline;
    result[field] = round2(number(current[field]) - number(fieldBaseline?.[field]));
  }""",
'numeric diff baseline')
s = replace_once(s,
"""export function compareBlindDeclaration(snapshot, declaration, config = {}) {""",
"""export function compareBlindDeclaration(snapshot, declaration, config = {}, retiPendienteEntrada = 0) {""",
'compare signature')
s = replace_once(s,
"""  const cuentaCorrienteSigma = round2(snapshot?.cuentaCorriente);

  const diferencias = {
    clover: round2(cloverFisico - cloverSigma),
    payway: round2(paywayFisico - paywaySigma),
    retiros: round2(retirosDocumentados - retirosSigma),
    cuentaCorriente: round2(totalCuentaCorriente - cuentaCorrienteSigma),
  };""",
"""  const cuentaCorrienteSigma = round2(snapshot?.cuentaCorriente);
  const retirosPendienteEntrada = round2(retiPendienteEntrada);
  // Positivo: Sigma tiene RETI aún no respaldado por documentación física.
  // Negativo: hay documentación física aún no registrada como RETI en Sigma.
  const retirosPendienteSalida = round2(retirosPendienteEntrada + retirosSigma - retirosDocumentados);

  const diferencias = {
    clover: round2(cloverFisico - cloverSigma),
    payway: round2(paywayFisico - paywaySigma),
    retiros: round2(-retirosPendienteSalida),
    cuentaCorriente: round2(totalCuentaCorriente - cuentaCorrienteSigma),
  };""",
'carry calculation')
s = replace_once(s,
"""    hayDiferencias: !conceptosOk || !administrativoOk || !cajaOk,""",
"""    // Un pendiente RETI no bloquea el cierre individual si caja y conceptos operativos están bien.
    hayDiferencias: !conceptosOk || !cajaOk,
    hayPendienteAdministrativo: !administrativoOk,""",
'critical differences')
s = replace_once(s,
"""    retirosDocumentados,
    totalDepositario,""",
"""    retirosDocumentados,
    retirosPendienteEntrada,
    retirosPendienteSalida,
    totalDepositario,""",
'return carry fields')
p.write_text(s)

# server/supabase-auth.js
p = Path('server/supabase-auth.js')
s = p.read_text()
s = replace_once(s,
"""  'tolerancia_caja_aplicada',
  'corte_desde_at',""",
"""  'tolerancia_caja_aplicada',
  'administrativo_ok',
  'reti_pendiente_entrada',
  'reti_pendiente_salida',
  'reti_baseline_cierre_id',
  'reti_conciliacion',
  'corte_desde_at',""",
'closure select carry')
marker = """export async function saveClosureSigmaCut(request, cierreId, values) {"""
insert = """export async function getPreviousCashboxClosure(request, cierre) {
  const headers = apiHeaders(request);
  if (!headers || !cierre?.fecha || !Number(cierre?.caja_codigo)) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('fecha', `eq.${cierre.fecha}`);
  url.searchParams.set('caja_codigo', `eq.${Number(cierre.caja_codigo)}`);
  url.searchParams.set('id', `neq.${cierre.id}`);
  url.searchParams.set('estado', 'neq.CANCELADO');
  url.searchParams.set('corte_hasta_at', 'not.is.null');
  url.searchParams.set('select', 'id,corte_hasta_at,sigma_snapshot_acumulado,reti_pendiente_salida');
  url.searchParams.set('order', 'corte_hasta_at.desc,created_at.desc');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function saveClosureSigmaCut(request, cierreId, values) {"""
s = replace_once(s, marker, insert, 'previous cashbox function')
p.write_text(s)

# api/sigma/comparar.js
Path('api/sigma/comparar.js').write_text("""import {
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
    let retiPendienteEntrada = Number(cierre.reti_pendiente_entrada || 0);
    const snapshotCajaActual = hasSnapshot(snapshotTramo) && Number(snapshotTramo?.cajaCodigo || 0) === Number(cierre.caja_codigo || 0);

    if (!snapshotCajaActual) {
      const [[sales, accounting], anteriorUsuario, anteriorCaja] = await Promise.all([
        fetchTodayReports(cierre.fecha),
        getPreviousFrozenClosure(request, cierre),
        getPreviousCashboxClosure(request, cierre),
      ]);

      const acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      snapshotTramo = diffUserSnapshots(
        acumulado,
        anteriorUsuario?.sigma_snapshot_acumulado || {},
        anteriorCaja?.sigma_snapshot_acumulado || {},
      );
      retiPendienteEntrada = Number(anteriorCaja?.reti_pendiente_salida || 0);
      const capturadoAt = new Date().toISOString();
      const corteDesde = anteriorUsuario?.corte_hasta_at || `${cierre.fecha}T00:00:00-03:00`;

      cierre = await saveClosureSigmaCut(request, cierre.id, {
        sigma_snapshot_acumulado: acumulado,
        sigma_snapshot_tramo: snapshotTramo,
        sigma_baseline_cierre_id: anteriorUsuario?.id || null,
        reti_baseline_cierre_id: anteriorCaja?.id || null,
        reti_pendiente_entrada: retiPendienteEntrada,
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
    const comparison = compareBlindDeclaration(
      snapshotTramo,
      cierre?.declaracion_ciega || {},
      config || {},
      retiPendienteEntrada,
    );

    cierre = await saveClosureSigmaCut(request, cierre.id, {
      administrativo_ok: comparison.administrativoOk,
      reti_pendiente_entrada: comparison.retirosPendienteEntrada,
      reti_pendiente_salida: comparison.retirosPendienteSalida,
      reti_conciliacion: {
        pendienteEntrada: comparison.retirosPendienteEntrada,
        sigmaTramo: Number(snapshotTramo?.retiros || 0),
        fisicoTramo: comparison.retirosDocumentados,
        pendienteSalida: comparison.retirosPendienteSalida,
        sigmaMovimientos: Array.isArray(snapshotTramo?.retirosDocumentos) ? snapshotTramo.retirosDocumentos : [],
      },
    });

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      resultado: {
        coincidencias: comparison.coincidencias,
        conceptosOk: comparison.conceptosOk,
        administrativoOk: comparison.administrativoOk,
        cajaOk: comparison.cajaOk,
        hayDiferencias: comparison.hayDiferencias,
        hayPendienteAdministrativo: comparison.hayPendienteAdministrativo,
        avisos: {
          comprobantePendiente: Number(snapshotTramo?.pendienteContado || 0) > Number(config?.tolerancia_conceptos ?? 0.01),
          pendienteAdministrativo: comparison.hayPendienteAdministrativo,
        },
      },
      cierreNumero: Number(cierre?.cierre_nro || 1),
    });
  } catch (error) {
    console.error('Error comparación ciega Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error comparando con Sigma' });
  }
}
""")

# api/sigma/snapshot.js
Path('api/sigma/snapshot.js').write_text("""import {
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
    let retiPendienteEntrada = Number(cierre.reti_pendiente_entrada || 0);
    const snapshotCajaActual = hasSnapshot(snapshot) && Number(snapshot?.cajaCodigo || 0) === Number(cierre.caja_codigo || 0);

    if (!snapshotCajaActual) {
      const [[sales, accounting], anteriorUsuario, anteriorCaja] = await Promise.all([
        fetchTodayReports(cierre.fecha),
        getPreviousFrozenClosure(request, cierre),
        getPreviousCashboxClosure(request, cierre),
      ]);
      const acumulado = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo, cierre.caja_codigo);
      snapshot = diffUserSnapshots(
        acumulado,
        anteriorUsuario?.sigma_snapshot_acumulado || {},
        anteriorCaja?.sigma_snapshot_acumulado || {},
      );
      retiPendienteEntrada = Number(anteriorCaja?.reti_pendiente_salida || 0);
      const capturadoAt = cierre.corte_hasta_at || new Date().toISOString();
      cierre = await saveClosureSigmaCut(request, cierre.id, {
        sigma_snapshot_acumulado: acumulado,
        sigma_snapshot_tramo: snapshot,
        sigma_baseline_cierre_id: anteriorUsuario?.id || null,
        reti_baseline_cierre_id: anteriorCaja?.id || null,
        reti_pendiente_entrada: retiPendienteEntrada,
        sigma_snapshot_capturado_at: capturadoAt,
        corte_desde_at: anteriorUsuario?.corte_hasta_at || `${cierre.fecha}T00:00:00-03:00`,
        corte_hasta_at: capturadoAt,
      });
    }

    const config = await getDonatoCloseConfig(request);
    const comparison = compareBlindDeclaration(
      snapshot,
      cierre?.declaracion_ciega || {},
      config || {},
      retiPendienteEntrada,
    );

    cierre = await saveClosureSigmaCut(request, cierre.id, {
      administrativo_ok: comparison.administrativoOk,
      reti_pendiente_entrada: comparison.retirosPendienteEntrada,
      reti_pendiente_salida: comparison.retirosPendienteSalida,
      reti_conciliacion: {
        pendienteEntrada: comparison.retirosPendienteEntrada,
        sigmaTramo: Number(snapshot?.retiros || 0),
        fisicoTramo: comparison.retirosDocumentados,
        pendienteSalida: comparison.retirosPendienteSalida,
        sigmaMovimientos: Array.isArray(snapshot?.retirosDocumentos) ? snapshot.retirosDocumentos : [],
      },
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
""")

# src/App.tsx
p = Path('src/App.tsx')
s = p.read_text()
s = replace_once(s,
"""  hayDiferencias: boolean;
  avisos?: { comprobantePendiente?: boolean };""",
"""  hayDiferencias: boolean;
  hayPendienteAdministrativo?: boolean;
  avisos?: { comprobantePendiente?: boolean; pendienteAdministrativo?: boolean };""",
'blind comparison type')
s = replace_once(s,
"""  caja_ok?: boolean | null;
  correccion_motivo?: string | null;""",
"""  caja_ok?: boolean | null;
  administrativo_ok?: boolean | null;
  reti_pendiente_entrada?: number;
  reti_pendiente_salida?: number;
  correccion_motivo?: string | null;""",
'closure type carry')
s = replace_once(s,
"""  hayDiferencias: boolean;
  retirosDocumentados?: number;""",
"""  hayDiferencias: boolean;
  hayPendienteAdministrativo?: boolean;
  retirosDocumentados?: number;
  retirosPendienteEntrada?: number;
  retirosPendienteSalida?: number;""",
'full comparison type carry')
s = replace_once(s,
"""function comparisonMessage(result: BlindComparison) {
  if (result.conceptosOk && result.cajaOk) return 'Los conceptos y el resultado de caja coinciden.';""",
"""function comparisonMessage(result: BlindComparison) {
  if (result.conceptosOk && result.cajaOk && result.hayPendienteAdministrativo) return 'La caja y los medios coinciden. Queda un movimiento administrativo pendiente para el próximo cierre de esta caja.';
  if (result.conceptosOk && result.cajaOk) return 'Los conceptos y el resultado de caja coinciden.';""",
'comparison message')
s = replace_once(s,
"""    'caja_ok',
    'correccion_motivo',""",
"""    'caja_ok',
    'administrativo_ok',
    'reti_pendiente_entrada',
    'reti_pendiente_salida',
    'correccion_motivo',""",
'app select carry')
s = replace_once(s,
"""        caja_ok: result.cajaOk,
        closed_at: finalStatus === 'CERRADO' ? now : null,""",
"""        caja_ok: result.cajaOk,
        administrativo_ok: result.administrativoOk ?? null,
        closed_at: finalStatus === 'CERRADO' ? now : null,""",
'persist admin status')
s = replace_once(s,
"""      await writeAudit('CIERRE_SIN_DIFERENCIAS', {
        cierre_nro: closure.cierre_nro,
        resultado: result,
      });""",
"""      await writeAudit(result.hayPendienteAdministrativo ? 'CIERRE_CON_PENDIENTE_ADMINISTRATIVO' : 'CIERRE_SIN_DIFERENCIAS', {
        cierre_nro: closure.cierre_nro,
        resultado: result,
      });""",
'first close audit')
s = replace_once(s,
"""    await writeAudit(
      result.hayDiferencias ? 'ENVIADO_A_VALIDACION' : 'CIERRE_CORREGIDO_SIN_DIFERENCIAS',
      { cierre_nro: closure.cierre_nro, resultado: result, revision: revisionNumber }
    );""",
"""    await writeAudit(
      result.hayDiferencias
        ? 'ENVIADO_A_VALIDACION'
        : result.hayPendienteAdministrativo
          ? 'CIERRE_CORREGIDO_CON_PENDIENTE_ADMINISTRATIVO'
          : 'CIERRE_CORREGIDO_SIN_DIFERENCIAS',
      { cierre_nro: closure.cierre_nro, resultado: result, revision: revisionNumber }
    );""",
'second close audit')
s = replace_once(s,
"""      { label: 'Control administrativo RETI', ok: result.coincidencias.retiros, detail: 'Depositario + retiros de supervisores vs. RETI de la caja en Sigma' },""",
"""      { label: 'Control administrativo RETI', ok: result.coincidencias.retiros, detail: result.coincidencias.retiros ? 'Documentación conciliada con Sigma' : 'Queda pendiente para el próximo cierre de esta caja; no bloquea si caja y medios están OK' },""",
'review RETI text')
old_reti = """                <div className=\"compare-row reti-compare-row\"><div><span>RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Control por cuenta de caja, sin importar qué usuario registró el RETI</small>{snapshot.retirosDocumentos?.length ? <div className=\"reti-detail-list\">{snapshot.retirosDocumentos.map((retiro, index) => <div className=\"reti-detail-item\" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className=\"reti-detail-empty\">Sigma no devolvió detalle individual de los RETI en el snapshot guardado.</small>}</div><div className=\"compare-arrow\">→</div><div><span>Retiros documentados</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong><small className={fullComparison.coincidencias.retiros ? 'positive' : 'negative'}>{money.format(fullComparison.diferencias.retiros)} de diferencia administrativa · no incluye efectivo de cierre</small></div></div>"""
new_reti = """                <div className=\"compare-row reti-compare-row\"><div><span>RETI Sigma · Caja {closure.caja_codigo}</span><strong>{money.format(snapshot.retiros)}</strong><small>Movimientos nuevos de la caja desde el último corte de esa misma caja.</small>{Number(fullComparison.retirosPendienteEntrada || 0) !== 0 ? <small className=\"reti-carry-note\">Pendiente anterior: {money.format(Math.abs(Number(fullComparison.retirosPendienteEntrada || 0)))} · {Number(fullComparison.retirosPendienteEntrada || 0) > 0 ? 'Sigma pendiente de documentación' : 'documentación pendiente de Sigma'}</small> : null}{snapshot.retirosDocumentos?.length ? <div className=\"reti-detail-list\">{snapshot.retirosDocumentos.map((retiro, index) => <div className=\"reti-detail-item\" key={retiro.key || `${index}-${retiro.importe}`}><div><b>{money.format(retiro.importe)}</b><span>{retiro.usuarioNombre || (retiro.usuarioCodigo ? `Usuario ${retiro.usuarioCodigo}` : 'Usuario no informado')}</span></div>{retiro.concepto ? <small>{retiro.concepto}</small> : null}{retiro.observacion ? <small>{retiro.observacion}</small> : null}</div>)}</div> : <small className=\"reti-detail-empty\">Sin detalle adicional para este corte.</small>}</div><div className=\"compare-arrow\">→</div><div><span>Documentación física del cierre</span><strong>{money.format(totalDepositario + totalSupervisor)}</strong><small className={fullComparison.coincidencias.retiros ? 'positive' : 'negative'}>{fullComparison.coincidencias.retiros ? 'Conciliado' : `${money.format(Math.abs(Number(fullComparison.retirosPendienteSalida || 0)))} queda pendiente para el próximo cierre de Caja ${closure.caja_codigo}`}</small>{!fullComparison.coincidencias.retiros ? <small>{Number(fullComparison.retirosPendienteSalida || 0) > 0 ? 'Sigma tiene RETI pendiente de documentación física.' : 'Hay documentación física pendiente de registrarse como RETI en Sigma.'}</small> : null}</div></div>"""
s = replace_once(s, old_reti, new_reti, 'approver RETI row')
p.write_text(s)

# src/lib/closurePdf.ts
p = Path('src/lib/closurePdf.ts')
s = p.read_text()
s = replace_once(s,
"""  pair('Control administrativo RETI', adminOk ? 'OK' : 'REVISAR');""",
"""  pair('Control administrativo RETI', adminOk ? 'OK' : 'PENDIENTE PARA PROXIMO CIERRE');""",
'pdf admin label')
s = replace_once(s,
"""    tableRow('RETI administrativo', pesos.format(num(snapshot.retiros)), pesos.format(retirosDocumentados), pesos.format(num(fullComparison.diferencias?.retiros)));
    if (Array.isArray(snapshot.retirosDocumentos) && snapshot.retirosDocumentos.length) {""",
"""    tableRow('RETI administrativo', pesos.format(num(snapshot.retiros)), pesos.format(retirosDocumentados), pesos.format(num(fullComparison.diferencias?.retiros)));
    if (num(fullComparison.retirosPendienteEntrada)) {
      pair('Pendiente RETI recibido del cierre anterior', pesos.format(Math.abs(num(fullComparison.retirosPendienteEntrada))));
    }
    if (num(fullComparison.retirosPendienteSalida)) {
      const sentido = num(fullComparison.retirosPendienteSalida) > 0
        ? 'Sigma pendiente de documentacion fisica'
        : 'Documentacion fisica pendiente de Sigma';
      pair('Pendiente RETI para proximo cierre', pesos.format(Math.abs(num(fullComparison.retirosPendienteSalida))), 'Sentido', sentido);
    }
    if (Array.isArray(snapshot.retirosDocumentos) && snapshot.retirosDocumentos.length) {""",
'pdf carry details')
p.write_text(s)
