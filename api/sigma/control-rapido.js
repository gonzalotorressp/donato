import {
  buildBlindJourneys,
  buildUserSnapshot,
  fetchTodayReports,
  argentinaToday,
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


async function cacheRpc(request, fn, body) {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const auth = request.headers?.authorization || request.headers?.Authorization || '';
  if (!base || !key || !String(auth).startsWith('Bearer ')) return null;
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : true;
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

  // El ID contable es monotónico durante la jornada, pero la cantidad de VENT contables
  // no coincide necesariamente 1:1 con las filas del reporte de ventas. Por eso usamos
  // los extremos de ambas secuencias como anclas temporales y no emparejamos por índice.
  const globalAnchors = [];
  if (cacheVentIds.length && allSaleTimes.length) {
    globalAnchors.push({ id: cacheVentIds[0], seconds: allSaleTimes[0] });
    if (cacheVentIds.length > 1 && allSaleTimes.length > 1) {
      globalAnchors.push({
        id: cacheVentIds[cacheVentIds.length - 1],
        seconds: allSaleTimes[allSaleTimes.length - 1],
      });
    }
  }

  const shifts = journeys.map((j) => {
    const start = secondsFromTime(j.primeraVentaHora);
    const end = secondsFromTime(j.ultimaVentaHora);
    return { ...j, start, end };
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

    // Trazabilidad estricta: un RETI sólo se asigna automáticamente a una
    // jornada de la misma caja. Cruces con otra caja se sugieren, nunca se aplican.
    if (!chosen && estimated !== null) {
      const ordered = [...sameCaja].sort((a, b) => a.start - b.start);
      const inside = ordered.filter((j) => estimated >= j.start && estimated <= j.end);
      if (inside.length === 1) {
        chosen = inside[0];
      } else if (inside.length > 1) {
        chosen = [...inside].sort((a, b) => b.start - a.start)[0];
        confidence = 'MEDIA';
      } else if (ordered.length) {
        // Regla operativa Donato: un RETI entre turnos pertenece al cajero anterior.
        // Nadie entrega efectivo antes de comenzar a vender; normalmente es el cierre
        // o una rendición posterior al último comprobante de ese turno.
        const previous = ordered.filter((j) => j.end < estimated).sort((a, b) => b.end - a.end)[0] || null;
        const next = ordered.find((j) => j.start > estimated) || null;
        if (previous && next) {
          chosen = previous;
          confidence = 'ALTA';
        } else if (previous) {
          chosen = previous;
          confidence = 'MEDIA';
        } else if (next) {
          // La interpolación global puede adelantar algunos RETI respecto de su hora real.
          // Si el asiento contable ocurre después de los VENT del cajero anterior en esa
          // misma caja, pertenece al turno anterior aunque la hora estimada haya quedado
          // apenas antes del inicio de ese turno.
          const priorByAccountingOrder = ordered
            .filter((j) => j.end <= next.start)
            .sort((a, b) => b.end - a.end)[0] || null;
          if (priorByAccountingOrder) {
            chosen = priorByAccountingOrder;
            confidence = 'MEDIA';
          } else {
            chosen = null;
            confidence = 'SIN_ASIGNAR_PRE_TURNO';
          }
        }
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

    const forceRefresh = String(request.query?.recalcular || '') === '1';
    const historical = fecha < argentinaToday();
    if (historical && !forceRefresh) {
      const cached = await cacheRpc(request, 'donato_control_rapido_cache_get', { p_fecha: fecha });
      if (cached && Array.isArray(cached.controles)) {
        response.setHeader('Cache-Control', 'private, max-age=60');
        return response.status(200).json({ ...cached, desdeCache: true });
      }
    }

    const [sales, accounting, cachedRows] = await Promise.all([
      fetchTodayReports(fecha).then(([salesRows, accountingRows]) => ({ salesRows, accountingRows })),
      fetchCachedControlRows(request, fecha),
    ]).then(([reports, cache]) => [reports.salesRows, reports.accountingRows, cache]);
    const journeys = buildBlindJourneys(sales, accounting, fecha);
    const retiros = buildRetiAssignments(sales, accounting, fecha, journeys, cachedRows);
    const confirmedCorrections = await cacheRpc(request, 'donato_reti_correcciones_fecha', { p_fecha: fecha }) || [];
    for (const correction of confirmedCorrections) {
      const retiro = retiros.find((r) => Number(r.id) === Number(correction.retiro_id));
      if (!retiro || correction.estado === 'DESESTIMADA') continue;
      retiro.cajaOriginal = Number(correction.caja_original);
      retiro.cajaCodigo = Number(correction.caja_corregida);
      retiro.usuarioCodigo = Number(correction.usuario_sigma_codigo);
      retiro.usuarioNombre = correction.usuario_sigma_nombre || '';
      retiro.correccionAdministrativa = true;
      retiro.estadoCorreccion = correction.estado;
      retiro.motivoCorreccion = correction.motivo;
      retiro.jornadaIdAsignada = correction.jornada_id || null;
      retiro.confianza = 'CORREGIDO';
    }
    const retirosDisponibles = retiros.length;
    const retirosAsignadosCantidad = retiros.filter((r) => r.usuarioCodigo).length;

    const correctionSuggestions = [];
    // Sólo sugerimos una corrección de caja cuando el RETI NO pudo asignarse
    // correctamente a una jornada de su propia caja. La caja registrada siempre
    // tiene prioridad absoluta sobre coincidencias horarias de otras cajas.
    for (const retiro of retiros) {
      if (retiro.usuarioCodigo || retiro.correccionAdministrativa) continue;
      const sec = secondsFromTime(retiro.horaAproximada);
      if (sec === null) continue;
      const candidates = journeys
        .map((journey) => ({
          journey,
          start: secondsFromTime(journey.primeraVentaHora),
          end: secondsFromTime(journey.ultimaVentaHora),
        }))
        .filter((x) => x.start !== null && x.end !== null && sec >= x.start && sec <= x.end)
        .sort((x, y) => {
          // Si hubiera más de un candidato, priorizar el intervalo más ajustado.
          const spanX = x.end - x.start;
          const spanY = y.end - y.start;
          return spanX - spanY;
        });
      if (candidates.length !== 1) continue; // ambiguo: queda pendiente, no inventamos sugerencia
      const journey = candidates[0].journey;
      if (Number(journey.cajaCodigo) === Number(retiro.cajaCodigo)) continue;
      correctionSuggestions.push({
        retiroId: retiro.id, importe: retiro.importe,
        cajaRegistrada: retiro.cajaCodigo, cajaSugerida: journey.cajaCodigo,
        usuarioCodigo: journey.usuarioCodigo, usuarioNombre: journey.usuarioNombre,
        jornadaId: journey.jornadaId,
        horaAproximada: retiro.horaAproximada,
        motivo: 'RETI sin jornada compatible en su caja; única jornada activa detectada en otra caja',
        estado: 'SUGERIDA',
      });
    }

    const correccionById = new Map(confirmedCorrections.map((c) => [Number(c.retiro_id), c]));
    const retirosRevision = retiros.map((retiro) => {
      const suggestion = correctionSuggestions.find((x) => Number(x.retiroId) === Number(retiro.id)) || null;
      const correction = correccionById.get(Number(retiro.id)) || null;
      return {
        ...retiro,
        usuarioSugeridoCodigo: suggestion?.usuarioCodigo ?? retiro.usuarioCodigo ?? null,
        usuarioSugeridoNombre: suggestion?.usuarioNombre ?? journeys.find((j) => Number(j.usuarioCodigo) === Number(retiro.usuarioCodigo))?.usuarioNombre ?? null,
        cajaSugerida: suggestion?.cajaSugerida ?? retiro.cajaCodigo,
        estadoRevision: correction?.estado || (suggestion ? 'SUGERIDA' : 'SIN_OBSERVACION'),
        motivoRevision: correction?.motivo || suggestion?.motivo || null,
      };
    }).sort((a, b) => Number(a.cajaCodigo) - Number(b.cajaCodigo) || String(a.horaAproximada || '').localeCompare(String(b.horaAproximada || '')) || Number(a.id) - Number(b.id));

    const controles = journeys.map((journey) => {
      const snapshot = buildUserSnapshot(sales, accounting, fecha, journey.usuarioCodigo, journey.cajaCodigo);
      const jornadaStart = secondsFromTime(journey.primeraVentaHora);
      const jornadaEnd = secondsFromTime(journey.ultimaVentaHora);
      const asignados = retiros.filter((r) => {
        if (Number(r.usuarioCodigo) !== Number(journey.usuarioCodigo)) return false;
        if (Number(r.cajaCodigo) !== Number(journey.cajaCodigo)) return false;
        if (r.jornadaIdAsignada && String(r.jornadaIdAsignada) !== String(journey.jornadaId)) return false;
        const sec = secondsFromTime(r.horaAproximada);
        return sec === null || jornadaStart === null || jornadaEnd === null || (sec >= jornadaStart && sec <= jornadaEnd);
      });
      const retirosAsignados = round2(asignados.reduce((sum, r) => sum + Number(r.importe || 0), 0));
      // Control histórico puramente Sigma:
      // Venta - RETI - Clover - Payway - Naranja - Cuenta corriente.
      // Positivo = efectivo faltante por rendir/retirar; negativo = sobrante.
      const diferenciaSigma = round2(
        Number(snapshot.venta || 0)
        - retirosAsignados
        - Number(snapshot.cloverDirecto || 0)
        - Number(snapshot.payway || 0)
        - Number(snapshot.naranja || 0)
        - Number(snapshot.cuentaCorriente || 0)
      );
      const sugerenciasCorreccion = correctionSuggestions.filter((x) => Number(x.usuarioCodigo) === Number(journey.usuarioCodigo));
      return {
        fecha,
        jornadaId: journey.jornadaId,
        jornadaNro: journey.jornadaNro,
        usuarioCodigo: journey.usuarioCodigo,
        usuarioNombre: journey.usuarioNombre,
        cajaCodigo: journey.cajaCodigo,
        primeraVentaHora: journey.primeraVentaHora || null,
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
        diferenciaSigma,
        estadoDiferencia: Math.abs(diferenciaSigma) <= 0.01
          ? 'OK'
          : diferenciaSigma > 0 ? 'FALTANTE' : 'SOBRANTE',
        retiros: asignados,
        sugerenciasCorreccion,
      };
    });

    const retirosSinAsignar = retiros.filter((r) => !r.usuarioCodigo);
    const payload = {
      fecha,
      criterioJornada: 'Jornada = cajero + caja + tramo continuo; cambio de caja, intervención de otro cajero en la caja o inactividad mayor a 2 horas inicia una nueva jornada',
      criterioReti: 'RETI asignado sólo a la jornada compatible de la misma caja; cruces con otra caja se muestran como posibles correcciones',
      diagnosticoReti: {
        cacheRows: cachedRows.length,
        retirosDisponibles,
        retirosAsignados: retirosAsignadosCantidad,
        retirosSinAsignar: retiros.filter((r) => !r.usuarioCodigo).length,
      },
      controles,
      retirosSinAsignar,
      retirosRevision,
      generadoAt: new Date().toISOString(),
      desdeCache: false,
    };
    if (historical) {
      await cacheRpc(request, 'donato_control_rapido_cache_put', { p_fecha: fecha, p_payload: payload });
    }
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(payload);
  } catch (error) {
    console.error('Error control rapido Donato', error);
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
