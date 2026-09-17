import {
  argentinaToday,
  buildBlindJourneys,
  buildUserSnapshot,
  fetchTodayReports,
  hasNewSalesSinceSnapshot,
} from '../../server/sigma.js';
import { getClosuresForDate, requireAuthenticatedUser } from '../../server/supabase-auth.js';

const DASHBOARD_CACHE_MS = 60000;
const DASHBOARD_STALE_MAX_MS = 10 * 60 * 1000;
const reportCache = new Map();
const inFlightByDate = new Map();

function hasSnapshot(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

async function getReportsForDashboard(fecha) {
  const now = Date.now();
  const cached = reportCache.get(fecha);

  if (cached && now - cached.fetchedAt <= DASHBOARD_CACHE_MS) {
    return { reports: cached.reports, source: 'cache', fetchedAt: cached.fetchedAt };
  }

  const existingRequest = inFlightByDate.get(fecha);
  if (existingRequest) {
    const result = await existingRequest;
    return { reports: result.reports, source: 'shared', fetchedAt: result.fetchedAt };
  }

  const request = (async () => {
    try {
      const reports = await fetchTodayReports(fecha);
      const result = { reports, fetchedAt: Date.now() };
      reportCache.set(fecha, result);
      return result;
    } catch (error) {
      const stale = reportCache.get(fecha);
      if (stale && Date.now() - stale.fetchedAt <= DASHBOARD_STALE_MAX_MS) {
        return { ...stale, stale: true };
      }
      throw error;
    } finally {
      inFlightByDate.delete(fecha);
    }
  })();

  inFlightByDate.set(fecha, request);
  const result = await request;
  return {
    reports: result.reports,
    source: result.stale ? 'stale' : 'sigma',
    fetchedAt: result.fetchedAt,
  };
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

    const fecha = typeof request.query?.fecha === 'string' ? request.query.fecha : argentinaToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      response.status(400).json({ error: 'Fecha inválida' });
      return;
    }

    const [sigmaResult, cierres] = await Promise.all([
      getReportsForDashboard(fecha),
      getClosuresForDate(request, fecha),
    ]);
    const [sales, accounting] = sigmaResult.reports;

    const baseJourneys = buildBlindJourneys(sales, accounting, fecha);
    const jornadas = baseJourneys.map((journey) => {
      const cierresUsuario = cierres
        .filter((item) => Number(item.usuario_sigma_codigo) === Number(journey.usuarioCodigo) && item.estado !== 'CANCELADO')
        .sort((a, b) => Number(a.cierre_nro || 0) - Number(b.cierre_nro || 0));

      const editable = cierresUsuario.find((item) => ['BORRADOR', 'REVISION_SUPERVISOR'].includes(item.estado));
      const congelados = cierresUsuario.filter((item) => hasSnapshot(item.sigma_snapshot_acumulado));
      const ultimoCongelado = congelados.length ? congelados[congelados.length - 1] : null;
      const acumuladoActual = buildUserSnapshot(sales, accounting, fecha, journey.usuarioCodigo, journey.cajaCodigo);
      const tieneActividadNueva = !editable && hasNewSalesSinceSnapshot(
        acumuladoActual,
        ultimoCongelado?.sigma_snapshot_acumulado || {}
      );

      const maxNumero = cierresUsuario.reduce((max, item) => Math.max(max, Number(item.cierre_nro || 0)), 0);
      return {
        ...journey,
        venta: Number(acumuladoActual.venta || 0),
        tieneActividadNueva,
        proximoCierreNumero: editable ? Number(editable.cierre_nro || Math.max(1, maxNumero)) : maxNumero + 1,
        cierreEditableId: editable?.id || null,
        cierreAnteriorId: ultimoCongelado?.id || null,
      };
    });

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Donato-Sigma-Cache', sigmaResult.source);
    response.status(200).json({
      fecha,
      jornadas,
      sigmaConsultadoAt: new Date(sigmaResult.fetchedAt).toISOString(),
      sigmaFuente: sigmaResult.source,
    });
  } catch (error) {
    console.error('Error jornadas Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
