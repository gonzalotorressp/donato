import { buildUserSnapshot, compareBlindDeclaration, fetchTodayReports } from '../../server/sigma.js';
import { getClosureForUser, getDonatoCloseConfig, requireAuthenticatedUser } from '../../server/supabase-auth.js';

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

    const cierreId = typeof request.query?.cierreId === 'string' ? request.query.cierreId : '';
    if (!cierreId) {
      response.status(400).json({ error: 'Falta cierreId' });
      return;
    }

    const cierre = await getClosureForUser(request, cierreId);
    if (!cierre) {
      response.status(404).json({ error: 'Cierre no encontrado' });
      return;
    }
    if (!cierre.carga_ciega_cerrada_at) {
      response.status(409).json({ error: 'Primero hay que cerrar la caja' });
      return;
    }

    const [reports, config] = await Promise.all([
      fetchTodayReports(cierre.fecha),
      getDonatoCloseConfig(request),
    ]);
    const [sales, accounting] = reports;
    const snapshot = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo);
    const comparison = compareBlindDeclaration(snapshot, cierre.declaracion_ciega || {}, config || {});

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      resultado: {
        coincidencias: comparison.coincidencias,
        conceptosOk: comparison.conceptosOk,
        cajaOk: comparison.cajaOk,
        hayDiferencias: comparison.hayDiferencias,
        avisos: {
          comprobantePendiente: Number(snapshot.pendienteContado || 0) > Number(config?.tolerancia_conceptos ?? 0.01),
        },
      },
    });
  } catch (error) {
    console.error('Error comparación ciega Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error comparando con Sigma' });
  }
}
