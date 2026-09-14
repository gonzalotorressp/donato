import { buildUserSnapshot, fetchTodayReports } from '../../server/sigma.js';
import { getClosureForUser, requireAuthenticatedUser } from '../../server/supabase-auth.js';

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
    if (!cierre.carga_ciega_cerrada_at || !cierre.submitted_at) {
      response.status(409).json({ error: 'La carga ciega todavía no fue cerrada' });
      return;
    }

    const [sales, accounting] = await fetchTodayReports(cierre.fecha);
    const snapshot = buildUserSnapshot(sales, accounting, cierre.fecha, cierre.usuario_sigma_codigo);
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ fecha: cierre.fecha, usuarioCodigo: cierre.usuario_sigma_codigo, snapshot });
  } catch (error) {
    console.error('Error snapshot Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
