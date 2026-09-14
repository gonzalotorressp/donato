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

export async function fetchSigmaReport(endpoint, fecha) {
  const url = new URL(endpoint);
  url.searchParams.set('fecdes', fecha);
  url.searchParams.set('fechas', fecha);
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sigma ${response.status}: ${body.slice(0, 800)}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Sigma no devolvió un array JSON');
  return data;
}

export async function fetchTodayReports(fecha) {
  return Promise.all([
    fetchSigmaReport(SALES_ENDPOINT, fecha),
    fetchSigmaReport(ACCOUNTING_ENDPOINT, fecha),
  ]);
}

function normalizedTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length >= 8 ? text.slice(0, 8) : text;
}

export function buildBlindJourneys(sales, accounting, fecha) {
  const usersWithSales = new Set();
  const lastSaleTimeByUser = new Map();
  const salesCountByUser = new Map();

  for (const row of sales) {
    if (row.fecha !== fecha || row.usuario === null || row.usuario === undefined) continue;
    const user = Number(row.usuario);
    usersWithSales.add(user);
    salesCountByUser.set(user, (salesCountByUser.get(user) || 0) + 1);
    const hora = normalizedTime(row.hora);
    if (hora && hora > (lastSaleTimeByUser.get(user) || '')) lastSaleTimeByUser.set(user, hora);
  }

  const nameByUser = new Map();
  const cashAccountByUser = new Map();
  for (const row of accounting) {
    if (row.fecha !== fecha || row.usuarioCodigo === null || row.usuarioCodigo === undefined) continue;
    const user = Number(row.usuarioCodigo);
    if (row.usuarioNombre) nameByUser.set(user, String(row.usuarioNombre).trim());
    if (
      String(row.comprobanteCodigo || '').trim().toUpperCase() === 'CODO' &&
      CASH_ACCOUNTS.has(Number(row.cuentaCodigo))
    ) {
      cashAccountByUser.set(user, Number(row.cuentaCodigo));
    }
  }

  return [...usersWithSales]
    .map((user) => {
      const account = cashAccountByUser.get(user);
      return {
        fecha,
        usuarioCodigo: user,
        usuarioNombre: nameByUser.get(user) || `Usuario ${user}`,
        cajaCodigo: account ? account - 1259 : null,
        ultimaVentaHora: lastSaleTimeByUser.get(user) || null,
        cantidadVentas: salesCountByUser.get(user) || 0,
      };
    })
    .sort((a, b) => a.usuarioNombre.localeCompare(b.usuarioNombre));
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

export function buildUserSnapshot(sales, accounting, fecha, usuarioCodigo) {
  const user = Number(usuarioCodigo);
  const relevantSales = sales.filter((row) => row.fecha === fecha && Number(row.usuario) === user);
  const relevantAccounting = accounting.filter((row) => row.fecha === fecha && Number(row.usuarioCodigo) === user);

  const snapshot = {
    venta: 0,
    efectivo: 0,
    cloverDirecto: 0,
    payway: 0,
    naranja: 0,
    cuentaCorriente: 0,
    pendienteContado: 0,
    retiros: 0,
    ventasDocumentos: [],
    cuentaCorrienteDocumentos: [],
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

  // RETI sigue siendo una conciliación administrativa: 130 no tiene hora y el usuario
  // registrador puede ser un supervisor. Se congela el acumulado disponible para poder
  // trabajar por diferencia entre cortes sin duplicarlo en cierres posteriores.
  for (const row of relevantAccounting) {
    if (String(row.comprobanteCodigo || '').trim().toUpperCase() !== 'RETI') continue;
    if (!CASH_ACCOUNTS.has(Number(row.cuentaCodigo))) continue;
    snapshot.retiros += Math.abs(number(row.monto || row.haber || row.debe));
  }

  for (const field of SNAPSHOT_NUMERIC_FIELDS) snapshot[field] = round2(snapshot[field]);

  const diferenciaVentaCodo = round2(snapshot.venta + codoDeudores);
  const residual = round2(diferenciaVentaCodo - snapshot.pendienteContado);
  snapshot.cuentaCorriente = round2(Math.max(0, Math.min(residual, Math.max(0, cuentaCorrienteCandidata))));

  snapshot.ventasDocumentos.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.key).localeCompare(String(b.key)));
  snapshot.cuentaCorrienteDocumentos.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.key).localeCompare(String(b.key)));
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

export function diffUserSnapshots(currentSnapshot, baselineSnapshot = {}) {
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
    ventasDocumentos: documentDifference(current.ventasDocumentos, baseline.ventasDocumentos),
    cuentaCorrienteDocumentos: documentDifference(current.cuentaCorrienteDocumentos, baseline.cuentaCorrienteDocumentos),
  };

  for (const field of SNAPSHOT_NUMERIC_FIELDS) {
    result[field] = round2(number(current[field]) - number(baseline[field]));
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

export function compareBlindDeclaration(snapshot, declaration, config = {}) {
  const toleranciaConceptos = Math.max(0, number(config.tolerancia_conceptos ?? 0.01));
  const toleranciaCaja = Math.max(0, number(config.tolerancia_caja ?? 0.01));

  const cloverFisico = round2(declaration?.cloverFisico);
  const paywayFisico = round2(declaration?.paywayFisico);
  const cierreEfectivo = round2(declaration?.cierreEfectivo);
  const totalDepositario = sumRows(declaration?.depositario);
  const totalSupervisor = sumRows(declaration?.retirosSupervisor);
  const totalCuentaCorriente = Array.isArray(declaration?.cuentasCorrientes)
    ? round2(declaration.cuentasCorrientes.reduce((sum, row) => sum + number(row?.importe), 0))
    : 0;

  const efectivoRendido = round2(totalDepositario + totalSupervisor + cierreEfectivo);
  const cloverSigma = round2(number(snapshot?.cloverDirecto) + number(snapshot?.naranja));
  const paywaySigma = round2(snapshot?.payway);
  const retirosSigma = round2(snapshot?.retiros);
  const cuentaCorrienteSigma = round2(snapshot?.cuentaCorriente);

  const diferencias = {
    clover: round2(cloverFisico - cloverSigma),
    payway: round2(paywayFisico - paywaySigma),
    retiros: round2(efectivoRendido - retirosSigma),
    cuentaCorriente: round2(totalCuentaCorriente - cuentaCorrienteSigma),
  };

  // Resultado neto del tramo: permite distinguir dinero faltante/sobrante de conceptos cruzados.
  const totalFisicoControlado = round2(efectivoRendido + cloverFisico + paywayFisico + totalCuentaCorriente);
  const totalSigmaControlado = round2(
    number(snapshot?.efectivo) + cloverSigma + paywaySigma + cuentaCorrienteSigma
  );
  const diferenciaCaja = round2(totalFisicoControlado - totalSigmaControlado);

  const coincidencias = {
    clover: Math.abs(diferencias.clover) <= toleranciaConceptos,
    payway: Math.abs(diferencias.payway) <= toleranciaConceptos,
    retiros: Math.abs(diferencias.retiros) <= toleranciaConceptos,
    cuentaCorriente: Math.abs(diferencias.cuentaCorriente) <= toleranciaConceptos,
  };

  const conceptosOk = Object.values(coincidencias).every(Boolean);
  const cajaOk = Math.abs(diferenciaCaja) <= toleranciaCaja;

  return {
    coincidencias,
    conceptosOk,
    cajaOk,
    hayDiferencias: !conceptosOk || !cajaOk,
    diferencias,
    diferenciaCaja,
    totalFisicoControlado,
    totalSigmaControlado,
    toleranciaConceptos,
    toleranciaCaja,
  };
}
