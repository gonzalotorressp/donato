import { buildUserSnapshot, compareBlindDeclaration, fetchTodayReports } from '../../server/sigma.js';
import { getClosureForUser, getDonatoCloseConfig, requireAuthenticatedUser, userHasCapability } from '../../server/supabase-auth.js';

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

    const cierre = await getClosureForUser(request, cierreId);
    if (!cierre) {
      response.status(404).json({ error: 'Cierre no encontrado' });
      return;
    }
    if (!['PENDIENTE_VALIDACION', 'AJUSTES_AUTORIZADOS', 'AJUSTADO', 'CERRADO'].includes(cierre.estado)) {
      response.status(409).json({ error: 'El cierre todavía está en revisión del Supervisor de Caja' });
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
      fecha: cierre.fecha,
      usuarioCodigo: cierre.usuario_sigma_codigo,
      snapshot,
      comparison,
    });
  } catch (error) {
    console.error('Error snapshot Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
