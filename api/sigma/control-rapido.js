import {
  buildBlindJourneys,
  buildUserSnapshot,
  fetchTodayReports,
} from '../../server/sigma.js';
import { requireAuthenticatedUser, userHasCapability } from '../../server/supabase-auth.js';

function rowId(row) {
  const value = Number(row?.id ?? row?.ID);
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
  return Math.abs(Number(row?.monto || row?.haber || row?.debe || 0));
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function buildRetiAssignments(sales, accounting, fecha, journeys) {
  const cashAccountByUser = new Map(
    journeys.filter((j) => j.cajaCodigo).map((j) => [Number(j.usuarioCodigo), 1259 + Number(j.cajaCodigo)])
  );
  const anchorsByCashAccount = new Map();

  for (const journey of journeys) {
    const user = Number(journey.usuarioCodigo);
    const cashAccount = cashAccountByUser.get(user);
    if (!cashAccount) continue;

    const ventIds = [...new Set(accounting
      .filter((row) => row.fecha === fecha
        && Number(row.usuarioCodigo) === user
        && String(row.comprobanteCodigo || '').trim().toUpperCase() === 'VENT'
        && Number(row.cuentaCodigo) === 4000)
      .map(rowId).filter(Boolean))].sort((a, b) => a - b);

    const saleTimes = sales
      .filter((row) => row.fecha === fecha && Number(row.usuario) === user)
      .map((row) => secondsFromTime(row.hora)).filter((v) => v !== null)
      .sort((a, b) => a - b);

    const count = Math.min(ventIds.length, saleTimes.length);
    if (!count) continue;
    const anchors = anchorsByCashAccount.get(cashAccount) || [];
    for (let index = 0; index < count; index += 1) {
      const vi = count === 1 ? 0 : Math.round(index * (ventIds.length - 1) / (count - 1));
      const si = count === 1 ? 0 : Math.round(index * (saleTimes.length - 1) / (count - 1));
      anchors.push({ id: ventIds[vi], seconds: saleTimes[si], user });
    }
    anchorsByCashAccount.set(cashAccount, anchors);
  }

  for (const anchors of anchorsByCashAccount.values()) anchors.sort((a, b) => a.id - b.id);

  const assignments = [];
  for (const row of accounting) {
    if (row.fecha !== fecha || String(row.comprobanteCodigo || '').trim().toUpperCase() !== 'RETI') continue;
    const cashAccount = Number(row.cuentaCodigo);
    if (cashAccount < 1260 || cashAccount > 1263) continue;
    const id = rowId(row);
    if (!id) continue;
    const anchors = anchorsByCashAccount.get(cashAccount) || [];
    if (!anchors.length) {
      assignments.push({ id, cajaCodigo: cashAccount - 1259, importe: round2(amount(row)), usuarioCodigo: null, horaAproximada: null, confianza: 'SIN_ANCLA' });
      continue;
    }

    let before = null;
    let after = null;
    for (const anchor of anchors) {
      if (anchor.id <= id) before = anchor;
      if (anchor.id >= id) { after = anchor; break; }
    }

    let chosen = null;
    let confidence = 'BAJA';
    if (before && after && before.user === after.user) {
      chosen = before;
      confidence = 'ALTA';
    } else if (before && after) {
      chosen = (id - before.id) <= (after.id - id) ? before : after;
      confidence = 'MEDIA';
    } else {
      chosen = before || after;
      confidence = 'BAJA';
    }

    let estimated = chosen?.seconds ?? null;
    if (before && after && before.id !== after.id) {
      const ratio = (id - before.id) / (after.id - before.id);
      estimated = before.seconds + ratio * (after.seconds - before.seconds);
    }

    assignments.push({
      id,
      cajaCodigo: cashAccount - 1259,
      importe: round2(amount(row)),
      usuarioCodigo: chosen?.user ?? null,
      horaAproximada: timeFromSeconds(estimated),
      confianza: confidence,
      registradoPorCodigo: Number(row.usuarioCodigo) || null,
      registradoPorNombre: String(row.usuarioNombre || '').trim() || null,
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
        retiros: asignados,
      };
    });

    const retirosSinAsignar = retiros.filter((r) => !r.usuarioCodigo);
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      fecha,
      criterioReti: 'ID contable RETI cruzado con secuencia VENT y horarios de venta del cajero en la misma caja',
      controles,
      retirosSinAsignar,
      generadoAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error control rapido Donato', error);
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
