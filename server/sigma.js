const SALES_ENDPOINT =
  process.env.SIGMA_DONATO_VENTAS_ENDPOINT ||
  `${process.env.SIGMA_BASE_URL}/custom/129-ventas_resumen`;

const ACCOUNTING_ENDPOINT =
  process.env.SIGMA_DONATO_CONTABLE_ENDPOINT ||
  `${process.env.SIGMA_BASE_URL}/custom/130-contable`;

const CASH_ACCOUNTS = new Set([1260, 1261, 1262, 1263]);
const SNAPSHOT_NUMERIC_FIELDS = [
  'venta',
  'efectivo',
  'cloverDirecto',
  'payway',
  'naranja',
  'cuentaCorriente',
  'pendienteContado',
  'retiros',
];

const SIGMA_MIN_INTERVAL_MS = Math.max(0, Number(process.env.SIGMA_MIN_INTERVAL_MS || 30000));
let sigmaQueue = Promise.resolve();
let lastSigmaCallAt = 0;

export function argentinaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function headers() {
  const token = process.env.SIGMA_API_TOKEN;
  if (!token) throw new Error('Falta SIGMA_API_TOKEN');
  return {
    accept: 'application/json',
    'X-Auth-Token': token,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFromSigma(body) {
  const match = String(body || '').match(/wait\s+(\d+)ms/i);
  return match ? Number(match[1]) : null;
}

function enqueueSigma(task) {
  const run = sigmaQueue.then(task, task);
  sigmaQueue = run.catch(() => undefined);
  return run;
}

export function fetchSigmaReport(endpoint, fecha) {
  return enqueueSigma(async () => {
    const url = new URL(endpoint);
    url.searchParams.set('fecdes', fecha);
    url.searchParams.set('fechas', fecha);

    const elapsed = Date.now() - lastSigmaCallAt;
    const initialWait = lastSigmaCallAt ? Math.max(0, SIGMA_MIN_INTERVAL_MS - elapsed) : 0;
    if (initialWait > 0) await sleep(initialWait);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, { headers: headers() });
      lastSigmaCallAt = Date.now();

      if (response.status === 429) {
        const body = await response.text();
        const retryMs = retryDelayFromSigma(body) ?? SIGMA_MIN_INTERVAL_MS;
        if (attempt === 0) {
          await sleep(Math.max(250, retryMs + 250));
          continue;
        }
        throw new Error('Sigma está ocupado. Reintentá en unos segundos.');
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Sigma ${response.status}: ${body.slice(0, 800)}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Sigma no devolvió un array JSON');
      return data;
    }

    throw new Error('No se pudo consultar Sigma');
  });
}

export async function fetchTodayReports(fecha) {
  const sales = await fetchSigmaReport(SALES_ENDPOINT, fecha);
  const accounting = await fetchSigmaReport(ACCOUNTING_ENDPOINT, fecha);
  return [sales, accounting];
}

function normalizedTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length >= 8 ? text.slice(0, 8) : text;
}

export function buildBlindJourneys(sales, accounting, fecha) {
  const INACTIVITY_LIMIT_SECONDS = 2 * 60 * 60;
  const nameByUser = new Map();
  const cashEvents = [];

  for (const row of accounting) {
    if (row.fecha !== fecha || row.usuarioCodigo === null || row.usuarioCodigo === undefined) continue;
    const user = Number(row.usuarioCodigo);
    if (row.usuarioNombre) nameByUser.set(user, String(row.usuarioNombre).trim());
    if (String(row.comprobanteCodigo || '').trim().toUpperCase() === 'CODO' && CASH_ACCOUNTS.has(Number(row.cuentaCodigo))) {
      const rawTime = normalizedTime(row.hora);
      cashEvents.push({ user, cajaCodigo: Number(row.cuentaCodigo) - 1259, hora: rawTime });
    }
  }

  // Cuando 130 no trae hora, inferimos la caja del usuario por sus CODO del día.
  // Si hay más de una caja, cada cambio observado genera una jornada independiente.
  const boxesByUser = new Map();
  for (const event of cashEvents) {
    if (!boxesByUser.has(event.user)) boxesByUser.set(event.user, []);
    const boxes = boxesByUser.get(event.user);
    if (!boxes.includes(event.cajaCodigo)) boxes.push(event.cajaCodigo);
  }

  const saleEvents = sales
    .filter((row) => row.fecha === fecha && row.usuario !== null && row.usuario !== undefined)
    .map((row) => ({ row, user: Number(row.usuario), hora: normalizedTime(row.hora) }))
    .filter((e) => e.hora)
    .sort((x, y) => x.hora.localeCompare(y.hora));

  const byUser = new Map();
  for (const event of saleEvents) {
    if (!byUser.has(event.user)) byUser.set(event.user, []);
    byUser.get(event.user).push(event);
  }

  const journeys = [];
  for (const [user, events] of byUser.entries()) {
    const boxes = boxesByUser.get(user) || [];
    // Con la información actual, una caja única queda inequívoca. Si Sigma registra
    // varias cajas para el usuario, se conserva la caja detectada cuando puede inferirse;
    // nunca se fusionan jornadas separadas por más de 2 horas.
    let current = null;
    for (const event of events) {
      const seconds = (() => { const m=event.hora.match(/(\d{2}):(\d{2})(?::(\d{2}))?/); return m ? Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0) : null; })();
      const cajaCodigo = boxes.length === 1 ? boxes[0] : (current?.cajaCodigo ?? boxes[0] ?? null);
      const splitByGap = current && seconds !== null && current.lastSeconds !== null && seconds - current.lastSeconds > INACTIVITY_LIMIT_SECONDS;
      if (!current || splitByGap || (current.cajaCodigo && cajaCodigo && current.cajaCodigo !== cajaCodigo)) {
        if (current) journeys.push(current);
        current = {
          fecha, jornadaId: `${fecha}-${user}-${journeys.filter((j)=>j.usuarioCodigo===user).length+1}`,
          jornadaNro: journeys.filter((j)=>j.usuarioCodigo===user).length+1,
          usuarioCodigo:user, usuarioNombre:nameByUser.get(user)||`Usuario ${user}`,
          cajaCodigo, primeraVentaHora:event.hora, ultimaVentaHora:event.hora,
          cantidadVentas:1, lastSeconds:seconds,
        };
      } else {
        current.ultimaVentaHora=event.hora; current.cantidadVentas+=1; current.lastSeconds=seconds;
      }
    }
    if (current) journeys.push(current);
  }

  // Si otro cajero ocupa la misma caja entre dos tramos del mismo usuario, esos tramos
  // no deben fusionarse. El corte de 2h ya separa los casos largos; esta pasada conserva
  // cada tramo generado como jornada independiente.
  return journeys.map(({lastSeconds,...j})=>j).sort((x,y)=>
    String(x.primeraVentaHora||'').localeCompare(String(y.primeraVentaHora||'')) ||
    Number(x.cajaCodigo||0)-Number(y.cajaCodigo||0)
  );
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function saleAmount(row) {
  return round2(number(row.subtotal) + number(row.iva) + number(row.comprobanteImpuestosInternos));
}

function isCurrentAccountSale(row) {
  const code = String(row.condicionDeVenta || '').trim().toUpperCase();
  const description = String(row.condicionDeVentaDescripcion || '').trim().toUpperCase();
  return description.includes('CTA CTE') || description.includes('CUENTA CORRIENTE') || code === '12';
}

function saleDocumentKey(row) {
  const comprobante = String(row.comprobante || '').trim();
  if (comprobante) return comprobante;
  return `${String(row.hora || '').trim()}|${String(row.cliente || '').trim()}|${saleAmount(row)}`;
}

export function buildUserSnapshot(sales, accounting, fecha, usuarioCodigo, cajaCodigo = null) {
  const user = Number(usuarioCodigo);
  const relevantSales = sales.filter((row) => row.fecha === fecha && Number(row.usuario) === user);
  const relevantAccounting = accounting.filter((row) => row.fecha === fecha && Number(row.usuarioCodigo) === user);
  const explicitCashAccount = Number(cajaCodigo) >= 1 && Number(cajaCodigo) <= 4
    ? 1259 + Number(cajaCodigo)
    : null;
  const detectedCashAccount = Number(
    relevantAccounting.find((row) =>
      String(row.comprobanteCodigo || '').trim().toUpperCase() === 'CODO' &&
      CASH_ACCOUNTS.has(Number(row.cuentaCodigo))
    )?.cuentaCodigo || 0
  ) || null;
  const cashAccount = explicitCashAccount || detectedCashAccount;

  const snapshot = {
    venta: 0,
    efectivo: 0,
    cloverDirecto: 0,
    payway: 0,
    naranja: 0,
    cuentaCorriente: 0,
    pendienteContado: 0,
    retiros: 0,
    cajaCodigo: cashAccount ? cashAccount - 1259 : null,
    ventasDocumentos: [],
    cuentaCorrienteDocumentos: [],
    retirosDocumentos: [],
  };

  let cuentaCorrienteCandidata = 0;
  let codoDeudores = 0;

  for (const row of relevantSales) {
    const amount = saleAmount(row);
    snapshot.ventasDocumentos.push({
      key: saleDocumentKey(row),
      comprobante: row.comprobante || '',
      hora: normalizedTime(row.hora),
      clienteCodigo: row.cliente || '',
      clienteNombre: row.clienteNombre || '',
      importe: amount,
    });

    if (isCurrentAccountSale(row)) {
      cuentaCorrienteCandidata += amount;
      snapshot.cuentaCorrienteDocumentos.push({
        key: saleDocumentKey(row),
        comprobante: row.comprobante || '',
        hora: normalizedTime(row.hora),
        clienteCodigo: row.cliente || '',
        clienteNombre: row.clienteNombre || '',
        importe: amount,
      });
    } else if (String(row.estado || '').trim().toUpperCase() !== 'PAGADO') {
      snapshot.pendienteContado += amount;
    }
  }

  for (const row of relevantAccounting) {
    const account = Number(row.cuentaCodigo);
    const voucher = String(row.comprobanteCodigo || '').trim().toUpperCase();
    const amount = number(row.monto);
    if (account === 4000 && voucher === 'VENT') snapshot.venta += amount;
    if (voucher === 'CODO') {
      if (CASH_ACCOUNTS.has(account)) snapshot.efectivo += amount;
      else if (account === 1271 || account === 1273) snapshot.cloverDirecto += amount;
      else if (account === 1272 || account === 1274) snapshot.payway += amount;
      else if (account === 1278) snapshot.naranja += amount;
      else if (account === 4000) codoDeudores += amount;
    }
  }

  // RETI es un control administrativo de la CAJA, no del usuario que lo registró.
  // En Sigma suele grabarlo un supervisor/encargado, por eso se busca por cuenta de caja.
  // Como 130 no tiene hora, se conserva el acumulado y los cierres partidos trabajan por delta.
  if (cashAccount) {
    for (const row of accounting) {
      if (row.fecha !== fecha) continue;
      if (String(row.comprobanteCodigo || '').trim().toUpperCase() !== 'RETI') continue;
      if (Number(row.cuentaCodigo) !== cashAccount) continue;
      const retiroImporte = Math.abs(number(row.monto || row.haber || row.debe));
      snapshot.retiros += retiroImporte;
      snapshot.retirosDocumentos.push({
        key: [
          Number(row.cuentaCodigo) || '',
          Number(row.usuarioCodigo) || '',
          String(row.concepto || '').trim(),
          String(row.observacion || '').trim(),
        ].join('|'),
        cuentaCodigo: Number(row.cuentaCodigo) || null,
        usuarioCodigo: Number(row.usuarioCodigo) || null,
        usuarioNombre: String(row.usuarioNombre || '').trim(),
        importe: round2(retiroImporte),
        concepto: String(row.concepto || '').trim(),
        observacion: String(row.observacion || '').trim(),
      });
    }
  }

  for (const field of SNAPSHOT_NUMERIC_FIELDS) snapshot[field] = round2(snapshot[field]);

  const diferenciaVentaCodo = round2(snapshot.venta + codoDeudores);
  const residual = round2(diferenciaVentaCodo - snapshot.pendienteContado);
  snapshot.cuentaCorriente = round2(Math.max(0, Math.min(residual, Math.max(0, cuentaCorrienteCandidata))));

  snapshot.ventasDocumentos.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.key).localeCompare(String(b.key)));
  snapshot.cuentaCorrienteDocumentos.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.key).localeCompare(String(b.key)));
  snapshot.retirosDocumentos.sort((a, b) => Number(b.importe || 0) - Number(a.importe || 0) || String(a.usuarioNombre || '').localeCompare(String(b.usuarioNombre || '')));
  return snapshot;
}

function documentDifference(currentRows, baselineRows) {
  const baselineCounts = new Map();
  for (const row of Array.isArray(baselineRows) ? baselineRows : []) {
    const key = String(row?.key || row?.comprobante || '');
    baselineCounts.set(key, (baselineCounts.get(key) || 0) + 1);
  }

  const result = [];
  for (const row of Array.isArray(currentRows) ? currentRows : []) {
    const key = String(row?.key || row?.comprobante || '');
    const remaining = baselineCounts.get(key) || 0;
    if (remaining > 0) baselineCounts.set(key, remaining - 1);
    else result.push(row);
  }
  return result;
}

function retiroMovementDifference(currentRows, baselineRows) {
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

export function diffUserSnapshots(currentSnapshot, baselineSnapshot = {}, cashboxBaselineSnapshot = baselineSnapshot) {
  const current = currentSnapshot || {};
  const baseline = baselineSnapshot || {};
  const result = {
    venta: 0,
    efectivo: 0,
    cloverDirecto: 0,
    payway: 0,
    naranja: 0,
    cuentaCorriente: 0,
    pendienteContado: 0,
    retiros: 0,
    cajaCodigo: current.cajaCodigo ?? baseline.cajaCodigo ?? null,
    ventasDocumentos: documentDifference(current.ventasDocumentos, baseline.ventasDocumentos),
    cuentaCorrienteDocumentos: documentDifference(current.cuentaCorrienteDocumentos, baseline.cuentaCorrienteDocumentos),
    retirosDocumentos: retiroMovementDifference(current.retirosDocumentos, cashboxBaselineSnapshot?.retirosDocumentos),
  };

  for (const field of SNAPSHOT_NUMERIC_FIELDS) {
    const fieldBaseline = field === 'retiros' ? cashboxBaselineSnapshot : baseline;
    result[field] = round2(number(current[field]) - number(fieldBaseline?.[field]));
  }
  return result;
}

export function hasNewSalesSinceSnapshot(currentSnapshot, baselineSnapshot = {}) {
  const currentDocs = Array.isArray(currentSnapshot?.ventasDocumentos) ? currentSnapshot.ventasDocumentos : [];
  const baselineDocs = Array.isArray(baselineSnapshot?.ventasDocumentos) ? baselineSnapshot.ventasDocumentos : [];
  if (currentDocs.length || baselineDocs.length) {
    return documentDifference(currentDocs, baselineDocs).length > 0;
  }
  return Math.abs(round2(number(currentSnapshot?.venta) - number(baselineSnapshot?.venta))) > 0.01;
}

function sumRows(rows) {
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
    ...(number(declaration?.cierreEfectivo) > 0 ? [{
      tipo: 'cierre',
      referencia: 'Efectivo entregado al cierre',
      importe: round2(declaration.cierreEfectivo),
    }] : []),
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

  const retirosDocumentados = round2(totalDepositario + totalSupervisor + cierreEfectivo);
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
