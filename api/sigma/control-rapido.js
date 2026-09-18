import {
  buildBlindJourneys,
  buildUserSnapshot,
  fetchTodayReports,
} from '../../server/sigma.js';
import { requireAuthenticatedUser, userHasCapability } from '../../server/supabase-auth.js';

function rowId(row) {
  const value = Number(row?.id ?? row?.ID ?? row?.Id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function secondsFromTime(value) {
  const match = String(value || '').match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function timeFromSeconds(value) {
  if (!Number.isFinite(value)) return null;
  const seconds = Math.max(0, Math.min(86399, Math.round(value)));
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}

function amount(row) {
  return Math.abs(Number(row?.monto ?? row?.MONTO ?? row?.haber ?? row?.HABER ?? row?.debe ?? row?.DEBE ?? 0));
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

async function fetchCachedControlRows(request, fecha) {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const auth = request.headers?.authorization || request.headers?.Authorization || '';
  if (!base || !key || !String(auth).startsWith('Bearer ')) return [];
  const response = await fetch(`${base}/rest/v1/rpc/donato_control_rapido_contable`, {
    method: 'POST',
    headers: { apikey: key, Authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ p_fecha: fecha }),
  });
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function buildRetiAssignments(sales, accounting, fecha, journeys, cachedRows = []) {
  const cacheVentIds = [...new Set(cachedRows
    .filter((r) => String(r.comprobante_codigo || '').toUpperCase() === 'VENT')
    .map((r) => Number(r.id)).filter(Number.isFinite))].sort((a, b) => a - b);
  const allSaleTimes = sales
    .filter((r) => r.fecha === fecha)
    .map((r) => secondsFromTime(r.hora)).filter((v) => v !== null)
    .sort((a, b) => a - b);

  const globalAnchors = [];
  const anchorCount = Math.min(cacheVentIds.length, allSaleTimes.length);
  for (let i = 0; i < anchorCount; i += 1) {
    const vi = anchorCount === 1 ? 0 : Math.round(i * (cacheVentIds.length - 1) / (anchorCount - 1));
    const si = anchorCount === 1 ? 0 : Math.round(i * (allSaleTimes.length - 1) / (anchorCount - 1));
    globalAnchors.push({ id: cacheVentIds[vi], seconds: allSaleTimes[si] });
  }

  const shifts = journeys.map((j) => {
    const times = sales.filter((r) => r.fecha === fecha && Number(r.usuario) === Number(j.usuarioCodigo))
      .map((r) => secondsFromTime(r.hora)).filter((v) => v !== null).sort((a, b) => a - b);
    return { ...j, start: times[0] ?? null, end: times[times.length - 1] ?? null };
  });

  const sourceRetis = cachedRows.length
    ? cachedRows.filter((r) => String(r.comprobante_codigo || '').toUpperCase() === 'RETI')
        .map((r) => ({ id: Number(r.id), cashAccount: Number(r.cuenta_codigo), importe: Math.abs(Number(r.importe || 0)), registradoPorCodigo: null, registradoPorNombre: null }))
    : accounting.filter((row) => row.fecha === fecha && String(row.comprobanteCodigo || '').trim().toUpperCase() === 'RETI')
        .map((row) => ({ id: rowId(row), cashAccount: Number(row.cuentaCodigo), importe: amount(row), registradoPorCodigo: Number(row.usuarioCodigo) || null, registradoPorNombre: String(row.usuarioNombre || '').trim() || null }));

  const assignments = [];
  for (const retiro of sourceRetis) {
    if (!retiro.id || retiro.cashAccount < 1260 || retiro.cashAccount > 1263) continue;
    let before = null, after = null;
    for (const anchor of globalAnchors) {
      if (anchor.id <= retiro.id) before = anchor;
      if (anchor.id >= retiro.id) { after = anchor; break; }
    }
    let estimated = before?.seconds ?? after?.seconds ?? null;
    let confidence = before && after ? 'ALTA' : (before || after ? 'MEDIA' : 'SIN_ANCLA');
    if (before && after && before.id !== after.id) {
      estimated = before.seconds + ((retiro.id - before.id) / (after.id - before.id)) * (after.seconds - before.seconds);
    }

    const cajaCodigo = retiro.cashAccount - 1259;
    const sameCaja = shifts.filter((j) => Number(j.cajaCodigo) === cajaCodigo && j.start !== null && j.end !== null);
    let chosen = null;
    if (estimated !== null) {
      const inside = sameCaja.filter((j) => estimated >= j.start - 900 && estimated <= j.end + 1800);
      if (inside.length === 1) chosen = inside[0];
      else if (inside.length > 1) {
        chosen = inside.sort((a, b) => Math.abs(estimated - b.end) - Math.abs(estimated - a.end))[0];
        confidence = 'MEDIA';
      } else if (sameCaja.length) {
        chosen = [...sameCaja].sort((a, b) => Math.min(Math.abs(estimated-a.start),Math.abs(estimated-a.end))-Math.min(Math.abs(estimated-b.start),Math.abs(estimated-b.end)))[0];
        confidence = 'BAJA';
      }
    }

    assignments.push({
      id: retiro.id, cajaCodigo, importe: round2(retiro.importe),
      usuarioCodigo: chosen?.usuarioCodigo ?? null,
      horaAproximada: timeFromSeconds(estimated), confianza: confidence,
      registradoPorCodigo: retiro.registradoPorCodigo, registradoPorNombre: retiro.registradoPorNombre,
    });
  }
  return assignments.sort((a, b) => a.id - b.id);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: 'No autorizado' });
    const isAdmin = await userHasCapability(request, 'donato.admin');
    if (!isAdmin) return response.status(403).json({ error: 'Control rápido disponible sólo para administradores' });

    const fecha = typeof request.query?.fecha === 'string' ? request.query.fecha : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return response.status(400).json({ error: 'Fecha inválida' });

    const [sales, accounting] = await fetchTodayReports(fecha);
    const journeys = buildBlindJourneys(sales, accounting, fecha);
    const retiros = buildRetiAssignments(sales, accounting, fecha, journeys);

    const controles = journeys.map((journey) => {
      const snapshot = buildUserSnapshot(sales, accounting, fecha, journey.usuarioCodigo, journey.cajaCodigo);
      const asignados = retiros.filter((r) => Number(r.usuarioCodigo) === Number(journey.usuarioCodigo));
      const retirosAsignados = round2(asignados.reduce((sum, r) => sum + Number(r.importe || 0), 0));
      return {
        fecha,
        usuarioCodigo: journey.usuarioCodigo,
        usuarioNombre: journey.usuarioNombre,
        cajaCodigo: journey.cajaCodigo,
        primeraVentaHora: sales.filter((r) => r.fecha === fecha && Number(r.usuario) === Number(journey.usuarioCodigo))
          .map((r) => String(r.hora || '')).filter(Boolean).sort()[0] || null,
        ultimaVentaHora: journey.ultimaVentaHora || null,
        cantidadVentas: journey.cantidadVentas || 0,
        venta: round2(snapshot.venta),
        efectivoCodo: round2(snapshot.efectivo),
        clover: round2(snapshot.cloverDirecto),
        payway: round2(snapshot.payway),
        naranja: round2(snapshot.naranja),
        cuentaCorriente: round2(snapshot.cuentaCorriente),
        pendienteContado: round2(snapshot.pendienteContado),
        retirosAsignados,
        efectivoTeoricoRestante: round2(Number(snapshot.efectivo || 0) - retirosAsignados),
        diferenciaSigma: round2(Number(snapshot.efectivo || 0) - retirosAsignados),
        estadoDiferencia: Math.abs(round2(Number(snapshot.efectivo || 0) - retirosAsignados)) <= 0.01
          ? 'OK'
          : round2(Number(snapshot.efectivo || 0) - retirosAsignados) > 0 ? 'FALTANTE' : 'SOBRANTE',
        retiros: asignados,
      };
    });

    const retirosSinAsignar = retiros.filter((r) => !r.usuarioCodigo);
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      fecha,
      criterioReti: 'ID contable RETI del cache cruzado con secuencia global VENT, horarios de venta y turno del cajero en la misma caja',
      controles,
      retirosSinAsignar,
      generadoAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error control rapido Donato', error);
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
